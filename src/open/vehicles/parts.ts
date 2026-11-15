import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type { CarPartId } from '../game/api';
import type { VehicleRig } from './model';

/**
 * 皮卡的改装件和车斗里的货：都是这里用代码搭出来的模型（方管、圆管、板子），顶点色、一个材质。
 * 开局全部建好；装了哪些就把哪些并成一个网格（一次绘制），没装的不画。
 *
 *   bullbar   车头的防撞杠（保险杠钢板 + 圆管护栏 + 大灯护翼）
 *   roofrack  驾驶室顶上的行李筐
 *   auxtank   车斗前面靠左的副油箱
 *   lightbar  车顶前沿的一排射灯（灯罩是单独一个会发光的小网格，开灯才亮）
 *   tires     四个轮子换成带胎块的网格 + 车斗里靠驾驶室立着一个备胎
 *   armor     前挡、后窗、两边车窗外面的护网（驾驶员那扇门上的跟着门转，单独一个网格）
 *
 * 尺寸是照着 T15 量的（.logs/veh/measure*.py）：车头朝 -Z，+X 是车的右边，原点在两轴中间的地面。别的车没有模型，只有效果。
 */

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const _c = new Color();

class Builder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  private r = 1;
  private g = 1;
  private b = 1;
  /** 整体平移（门上的护网要换算到门的支点坐标） */
  origin: V3 = [0, 0, 0];

  /** 之后搭的东西都是这个颜色（sRGB） */
  color(hex: number): this {
    _c.setHex(hex);
    this.r = _c.r;
    this.g = _c.g;
    this.b = _c.b;
    return this;
  }

  get indexCount(): number {
    return this.idx.length;
  }

  private vert(p: V3, n: V3): number {
    this.pos.push(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(this.r, this.g, this.b);
    return this.pos.length / 3 - 1;
  }

  /** 四边形：四个点逆时针（从法线那边看） */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3): void {
    const i = this.vert(a, n);
    this.vert(b, n);
    this.vert(c, n);
    this.vert(d, n);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** 斜着的长方体：中心 + 三个互相垂直的半轴 */
  obox(c: V3, ax: V3, ay: V3, az: V3): void {
    // 三个半轴要成右手系，不然面会朝里
    if (dot(cross(ax, ay), az) < 0) az = mul(az, -1);
    const axes: Array<[V3, V3, V3]> = [
      [ax, ay, az],
      [ay, az, ax],
      [az, ax, ay],
    ];
    for (const [n, u, v] of axes) {
      for (const s of [1, -1]) {
        const o = add(c, mul(n, s));
        const uu = mul(u, s);
        this.quad(add(o, add(mul(uu, -1), mul(v, -1))), add(o, add(uu, mul(v, -1))), add(o, add(uu, v)), add(o, add(mul(uu, -1), v)), norm(mul(n, s)));
      }
    }
  }

  /** 正着放的盒子：中心、长宽高（x, y, z），可以绕竖轴转 yaw */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.obox([cx, cy, cz], [(c * sx) / 2, 0, (-s * sx) / 2], [0, sy / 2, 0], [(s * sz) / 2, 0, (c * sz) / 2]);
  }

  /** 从 a 到 b 的一根方杆：截面 w（横）× h（沿 up 方向） */
  beam(a: V3, b: V3, w: number, h: number, up: V3 = [0, 1, 0]): void {
    const d = sub(b, a);
    let side = cross(d, up);
    if (len(side) < 1e-6) side = cross(d, [1, 0, 0]);
    side = norm(side);
    const v = norm(cross(side, d));
    this.obox(lerp(a, b, 0.5), mul(d, 0.5), mul(side, w / 2), mul(v, h / 2));
  }

  /** 从 a 到 b 的一根圆管（两头封口） */
  tube(a: V3, b: V3, r: number, seg = 8): void {
    const d = norm(sub(b, a));
    let u = cross(d, [0, 1, 0]);
    if (len(u) < 1e-6) u = cross(d, [1, 0, 0]);
    u = norm(u);
    const v = cross(d, u);
    const ring: V3[] = [];
    for (let k = 0; k <= seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      ring.push(add(mul(u, Math.cos(t)), mul(v, Math.sin(t))));
    }
    const base = this.pos.length / 3;
    for (let k = 0; k <= seg; k++) {
      const n = ring[k] as V3;
      this.vert(add(a, mul(n, r)), n);
      this.vert(add(b, mul(n, r)), n);
    }
    for (let k = 0; k < seg; k++) {
      const i = base + k * 2;
      this.idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
    this.disc(a, mul(d, -1), r, seg, u);
    this.disc(b, d, r, seg, u);
  }

  /** 圆片：圆心、法线、半径 */
  disc(c: V3, n: V3, r: number, seg = 10, hint: V3 = [0, 1, 0]): void {
    let u = cross(n, hint);
    if (len(u) < 1e-6) u = cross(n, [1, 0, 0]);
    u = norm(u);
    const v = cross(n, u);
    const i0 = this.vert(c, n);
    for (let k = 0; k <= seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      this.vert(add(c, add(mul(u, Math.cos(t) * r), mul(v, Math.sin(t) * r))), n);
    }
    for (let k = 0; k < seg; k++) this.idx.push(i0, i0 + 1 + k, i0 + 2 + k);
  }

  /** 一串点连成的圆管（防撞杠的弯管） */
  pipe(pts: V3[], r: number, seg = 8): void {
    for (let i = 0; i + 1 < pts.length; i++) this.tube(pts[i] as V3, pts[i + 1] as V3, r, seg);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function join(list: BufferGeometry[]): BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.getAttribute('position').count;
    ni += g.index ? g.index.count : 0;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0;
  let i0 = 0;
  for (const g of list) {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, v0 * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, v0 * 3);
    col.set(g.getAttribute('color').array as Float32Array, v0 * 3);
    const ia = g.index?.array;
    if (ia) for (let i = 0; i < ia.length; i++) idx[i0 + i] = (ia[i] as number) + v0;
    v0 += n;
    i0 += ia ? ia.length : 0;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  out.setIndex(new BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const STEEL = 0x17191c;
const STEEL2 = 0x24272b;

function bullbar(): BufferGeometry {
  const b = new Builder().color(STEEL2);
  const z = -2.475;
  // 保险杠外面包的一块钢板
  b.box(0, 0.5, -2.435, 1.82, 0.2, 0.09);
  b.color(STEEL);
  // 两根立柱（扁钢）
  for (const x of [-0.34, 0.34]) b.box(x, 0.81, z, 0.05, 0.56, 0.06);
  // 一圈弯管 + 中间一根横管
  b.pipe(
    [
      [-0.5, 0.58, z],
      [-0.5, 1.0, z],
      [-0.42, 1.09, z],
      [0.42, 1.09, z],
      [0.5, 1.0, z],
      [0.5, 0.58, z],
    ],
    0.028,
  );
  b.tube([-0.5, 0.84, z], [0.5, 0.84, z], 0.022);
  // 大灯护翼：从弯管两边往后拐到翼子板
  for (const s of [-1, 1]) {
    b.pipe(
      [
        [s * 0.5, 0.99, z],
        [s * 0.87, 0.96, -2.35],
        [s * 0.87, 0.64, -2.35],
        [s * 0.5, 0.62, z],
      ],
      0.02,
    );
    b.tube([s * 0.5, 0.8, z], [s * 0.87, 0.8, -2.35], 0.016);
  }
  return b.build();
}

function roofrack(): BufferGeometry {
  const b = new Builder().color(STEEL);
  const x = 0.7;
  const z0 = -0.3;
  const z1 = 0.28;
  const y0 = 1.93;
  const y1 = 2.05;
  for (const y of [y0, y1]) {
    b.pipe(
      [
        [-x, y, z0],
        [x, y, z0],
        [x, y, z1],
        [-x, y, z1],
        [-x, y, z0],
      ],
      0.016,
    );
  }
  // 立柱
  for (const px of [-x, 0, x]) for (const pz of [z0, z1]) b.tube([px, y0, pz], [px, y1, pz], 0.012, 6);
  for (const px of [-x, x]) b.tube([px, y0, (z0 + z1) / 2], [px, y1, (z0 + z1) / 2], 0.012, 6);
  // 底下的横条
  for (const pz of [-0.2, -0.07, 0.06, 0.19]) b.beam([-x, y0, pz], [x, y0, pz], 0.045, 0.014);
  // 四只脚踩在车顶上
  b.color(STEEL2);
  for (const px of [-x, x]) for (const pz of [-0.22, 0.2]) b.box(px, 1.865, pz, 0.05, 0.13, 0.1);
  return b.build();
}

function auxtank(): BufferGeometry {
  // 比车斗的栏板（顶 1.11）高出一截：从车外面看得见
  const b = new Builder().color(0x8f959b);
  b.box(-0.34, 1.02, 0.63, 0.64, 0.52, 0.34);
  // 两道箍带
  b.color(STEEL);
  for (const x of [-0.52, -0.16]) b.box(x, 1.023, 0.63, 0.035, 0.532, 0.352);
  // 加油口的盖子、通到原油箱的油管
  b.color(0x8a2018);
  b.tube([-0.34, 1.28, 0.63], [-0.34, 1.318, 0.63], 0.042, 10);
  b.color(STEEL);
  b.pipe(
    [
      [-0.6, 1.24, 0.72],
      [-0.72, 1.22, 0.76],
      [-0.72, 0.9, 0.76],
    ],
    0.013,
    6,
  );
  return b.build();
}

/** 射灯的位置（x），灯罩朝前 */
const POD_X = [-0.45, -0.15, 0.15, 0.45];
const POD_Y = 1.958;

function lightbar(): BufferGeometry {
  const b = new Builder().color(STEEL);
  b.tube([-0.62, 1.905, -0.4], [0.62, 1.905, -0.4], 0.018);
  for (const x of [-0.56, 0.56]) b.box(x, 1.86, -0.38, 0.04, 0.1, 0.05);
  for (const x of POD_X) b.tube([x, POD_Y, -0.35], [x, POD_Y, -0.455], 0.075, 12);
  return b.build();
}

function lenses(): BufferGeometry {
  const b = new Builder().color(0xd9d6cc);
  for (const x of POD_X) b.disc([x, POD_Y, -0.458], [0, 0, -1], 0.064, 12);
  return b.build();
}

/** 一块护网：四个角（逆时针，从外面看）+ 朝外的法线；cols / rows = 里面竖着、横着各几根 */
function grille(b: Builder, p: [V3, V3, V3, V3], n: V3, cols: number, rows: number): void {
  const [bl, br, tr, tl] = p;
  b.color(STEEL2);
  b.beam(bl, br, 0.03, 0.02, n);
  b.beam(br, tr, 0.03, 0.02, n);
  b.beam(tr, tl, 0.03, 0.02, n);
  b.beam(tl, bl, 0.03, 0.02, n);
  b.color(STEEL);
  for (let i = 1; i <= cols; i++) {
    const t = i / (cols + 1);
    b.beam(lerp(bl, br, t), lerp(tl, tr, t), 0.013, 0.013, n);
  }
  for (let j = 1; j <= rows; j++) {
    const t = j / (rows + 1);
    b.beam(lerp(bl, tl, t), lerp(br, tr, t), 0.013, 0.013, n);
  }
}

/** 侧窗的四个角（s = 1 右边，-1 左边）：玻璃往上往里收，护网贴在外面 3.5 厘米 */
function sideWindow(s: number): [V3, V3, V3, V3] {
  const xb = s * 0.853;
  const xt = s * 0.803;
  const q: [V3, V3, V3, V3] = [
    [xb, 1.09, -0.86],
    [xb, 1.09, 0.14],
    [xt, 1.74, 0.14],
    [xt, 1.74, -0.4],
  ];
  // 左边：前后两个角对调，保持从外面看是逆时针
  return s > 0 ? q : [q[1], q[0], q[3], q[2]];
}

function armorStatic(passengerSide: number): BufferGeometry {
  const b = new Builder();
  // 前挡：下边 (y 1.095, z -0.92) 到上边 (y 1.765, z -0.44) 的斜面，往外 4 厘米
  const n: V3 = norm([0, 0.582, -0.813]);
  const o = mul(n, 0.04);
  grille(b, [add([0.72, 1.12, -0.9], o), add([-0.72, 1.12, -0.9], o), add([-0.69, 1.74, -0.458], o), add([0.69, 1.74, -0.458], o)], n, 7, 2);
  // 后窗
  grille(
    b,
    [
      [-0.58, 1.13, 0.332],
      [0.58, 1.13, 0.332],
      [0.57, 1.71, 0.332],
      [-0.57, 1.71, 0.332],
    ],
    [0, 0, 1],
    5,
    2,
  );
  // 副驾那边的车窗
  grille(b, sideWindow(passengerSide), [passengerSide, 0.07, 0], 3, 3);
  return b.build();
}

/** 驾驶员那扇门上的护网：坐标换到门的支点上，跟着门一起转 */
function armorDoor(side: number, pivot: V3): BufferGeometry {
  const b = new Builder();
  b.origin = pivot;
  grille(b, sideWindow(side), [side, 0.07, 0], 3, 3);
  return b.build();
}

/** 车斗里的货：三档，越多画得越多。返回几何体和每一档画到第几个索引 */
function cargo(): { geo: BufferGeometry; steps: number[] } {
  const b = new Builder();
  const Y = 0.76;
  const steps: number[] = [];
  // 一档：一个弹药箱、一个纸箱
  b.color(0x4a5133).box(-0.3, Y + 0.14, 1.75, 0.55, 0.28, 0.36, 0.1);
  b.color(0x383d27).box(-0.3, Y + 0.283, 1.75, 0.57, 0.012, 0.1, 0.1);
  b.color(0x8b6b46).box(0.32, Y + 0.16, 1.7, 0.42, 0.32, 0.4, -0.15);
  b.color(0xb9a585).box(0.32, Y + 0.322, 1.7, 0.43, 0.006, 0.07, -0.15);
  steps.push(b.indexCount);
  // 二档：再来一个木箱、一个灰色周转箱，弹药箱上摞一个小纸箱
  b.color(0x77593a).box(-0.25, Y + 0.18, 1.22, 0.6, 0.36, 0.44, -0.06);
  b.color(0x5d452c);
  for (const dz of [-0.15, 0.15]) b.box(-0.25, Y + 0.18, 1.22 + dz, 0.61, 0.37, 0.05, -0.06);
  b.color(0x565b60).box(0.34, Y + 0.15, 1.18, 0.44, 0.3, 0.52, 0.08);
  b.color(0x3f4347).box(0.34, Y + 0.31, 1.18, 0.46, 0.03, 0.54, 0.08);
  b.color(0x97774f).box(-0.3, Y + 0.28 + 0.11, 1.75, 0.36, 0.22, 0.3, 0.4);
  steps.push(b.indexCount);
  // 三档：汽油桶、摞起来的箱子和包、一卷篷布
  b.color(0x7d2018).box(0.55, Y + 0.23, 2.0, 0.16, 0.46, 0.34, 0.05);
  b.color(0x2a2c2e).box(0.55, Y + 0.48, 2.0, 0.05, 0.04, 0.2, 0.05);
  b.color(0x8b6b46).box(-0.22, Y + 0.36 + 0.13, 1.2, 0.4, 0.26, 0.36, -0.3);
  b.color(0x3b4230).box(0.32, Y + 0.33 + 0.11, 1.18, 0.34, 0.22, 0.58, 0.02);
  b.color(0x2f4763).tube([-0.6, Y + 0.09, 0.98], [0.6, Y + 0.09, 0.98], 0.09, 10);
  steps.push(b.indexCount);
  return { geo: b.build(), steps };
}

export class CarParts {
  /** 挂在车的 lean 节点下（车身坐标） */
  readonly group = new Group();
  private readonly geos = new Map<CarPartId, BufferGeometry>();
  private readonly mesh: Mesh;
  private readonly lens: Mesh | null = null;
  private readonly lensMat: MeshStandardMaterial;
  private readonly door: Mesh | null = null;
  private readonly spare: Mesh | null = null;
  private readonly cargoMesh: Mesh | null = null;
  private cargoSteps: number[] = [];
  private merged: BufferGeometry | null = null;
  private readonly has = new Set<CarPartId>();
  private level = 0;
  private lod = 0;

  constructor(
    private readonly rig: VehicleRig,
    driverDoor: string | null,
    side: number,
  ) {
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.15 });
    mat.name = 'car-parts';
    this.lensMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: 0xfff2d8, emissiveIntensity: 0 });
    this.lensMat.name = 'car-lens';
    this.group.name = 'parts';
    const model = rig.def.id === 'pickup_t15';
    if (model) {
      this.geos.set('bullbar', bullbar());
      this.geos.set('roofrack', roofrack());
      this.geos.set('auxtank', auxtank());
      this.geos.set('lightbar', lightbar());
      this.geos.set('armor', armorStatic(-(side || -1)));
    }
    // 开局先放一个「全装上」的网格（藏着）：着色器在加载时就按这种顶点格式编译好，装第一个件的时候不会卡
    this.mesh = new Mesh(model ? join([...this.geos.values()]) : new BufferGeometry(), mat);
    this.merged = this.mesh.geometry;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    if (!model) return;
    this.lens = new Mesh(lenses(), this.lensMat);
    this.lens.visible = false;
    this.group.add(this.lens);
    const c = cargo();
    this.cargoSteps = c.steps;
    this.cargoMesh = new Mesh(c.geo, mat);
    this.cargoMesh.castShadow = true;
    this.cargoMesh.receiveShadow = true;
    this.cargoMesh.visible = false;
    this.group.add(this.cargoMesh);
    if (driverDoor) {
      const node = rig.attach(driverDoor);
      this.door = new Mesh(armorDoor(side || -1, rig.def.bones[driverDoor] ?? [0, 0, 0]), mat);
      this.door.receiveShadow = true;
      this.door.visible = false;
      node.add(this.door);
    }
    // 备胎：立在车斗前面靠右，贴着驾驶室
    this.spare = rig.spareWheel();
    if (this.spare) {
      this.spare.rotation.y = Math.PI / 2;
      this.spare.position.set(0.36, 0.76 + 0.385, 0.57);
      this.spare.visible = false;
      this.group.add(this.spare);
    }
  }

  /** 装了哪些：重新并一次网格（很少发生，几千个顶点） */
  set(parts: ReadonlySet<CarPartId>): void {
    this.has.clear();
    for (const p of parts) this.has.add(p);
    const list: BufferGeometry[] = [];
    for (const [id, g] of this.geos) if (parts.has(id)) list.push(g);
    if (this.merged) this.merged.dispose();
    this.merged = list.length ? join(list) : null;
    if (this.merged) this.mesh.geometry = this.merged;
    this.rig.setTires(parts.has('tires'));
    this.apply();
  }

  /** 射灯的灯罩亮不亮 */
  setLights(on: boolean): void {
    this.lensMat.emissiveIntensity = on && this.has.has('lightbar') ? 9 : 0;
  }

  /**
   * 跟着车身的远近档走（改装件挂在车身节点下，自己不知道远近）：
   * 0 近处：都画，投影子 · 1 远模（45 米外）：只画并好的那一个网格（防撞杠、行李架的轮廓还在），不投影子 · 2 很远：不画
   */
  setLod(lod: number): void {
    if (lod === this.lod) return;
    this.lod = lod;
    this.apply();
  }

  /** 车斗里的货：0 = 空，1 = 堆满（分三档） */
  setCargo(k: number): void {
    const level = k <= 0 ? 0 : k < 0.34 ? 1 : k < 0.67 ? 2 : 3;
    if (level === this.level || !this.cargoMesh) return;
    this.level = level;
    if (level > 0) this.cargoMesh.geometry.setDrawRange(0, this.cargoSteps[level - 1] as number);
    this.apply();
  }

  private apply(): void {
    const near = this.lod === 0;
    this.group.visible = this.lod < 2;
    this.mesh.visible = !!this.merged;
    this.mesh.castShadow = near;
    if (this.lens) this.lens.visible = near && this.has.has('lightbar');
    // 门上的护网不在 group 下面（挂在门的节点上），自己管
    if (this.door) this.door.visible = near && this.has.has('armor');
    if (this.spare) this.spare.visible = near && this.has.has('tires');
    if (this.cargoMesh) this.cargoMesh.visible = near && this.level > 0;
  }
}
