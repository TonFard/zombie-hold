import { Group, Path, Shape, Vector3 } from 'three';
import { Builder, toGroup, type Style } from '../kit';

/**
 * 枪械建模工具：在 kit.ts 的基础形体上加了"侧面轮廓挤出"和可动零件。
 * 局部坐标：原点在后握把（右手位置），枪口朝 +Z，上方为 +Y，单位为米。
 * 玩家从右后方看枪，看到的是枪的左侧（+X 面），所以细节主要放在 +X 一侧。
 */

export type PartName = 'slide' | 'mag' | 'pump' | 'bolt' | 'drum' | 'belt';

/** 开火 / 上膛的机构类型，决定视角模型怎么动 */
export type Action = 'semi' | 'auto' | 'pump' | 'bolt' | 'revolver';

export interface GunInfo {
  gripR: Vector3;
  gripL: Vector3;
  muzzle: Vector3;
  /** 抛壳口 */
  eject: Vector3;
  /** 瞄准线上的一点（照门 / 红点 / 镜筒中心），瞄准时这点对准屏幕中心 */
  sight: Vector3;
  /** 瞄准时眼睛离 sight 多远（米） */
  eyeRelief: number;
  /** 开火时套筒 / 枪机后坐的距离 */
  slideTravel: number;
  action: Action;
}

export class GunKit {
  readonly b = new Builder();
  private readonly parts = new Map<PartName, { b: Builder; pivot: Vector3 }>();

  constructor(readonly t: number) {}

  /** 可动零件：坐标仍按枪的局部坐标写，内部减掉支点，组的位置放在支点上，方便绕支点旋转 */
  part(name: PartName, pivot = new Vector3()): Builder {
    let p = this.parts.get(name);
    if (!p) {
      const b = new Builder();
      b.push({ x: -pivot.x, y: -pivot.y, z: -pivot.z });
      p = { b, pivot: pivot.clone() };
      this.parts.set(name, p);
    }
    return p.b;
  }

  finish(): { group: Group; parts: Partial<Record<PartName, Group>> } {
    const group = toGroup(this.b.build(), { smooth: true });
    const parts: Partial<Record<PartName, Group>> = {};
    for (const [name, p] of this.parts) {
      const g = toGroup(p.b.build(), { smooth: true });
      g.position.copy(p.pivot);
      group.add(g);
      parts[name] = g;
    }
    return { group, parts };
  }
}

// ---------------------------------------------------------------- 轮廓

/** 轮廓点：[z, y] 直线；[cz, cy, z, y] 二次曲线（控制点 + 终点） */
export type P = [number, number] | [number, number, number, number];

function draw(path: Path, pts: P[]): void {
  const first = pts[0] as P;
  path.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as P;
    if (p.length === 4) path.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else path.lineTo(p[0], p[1]);
  }
  path.closePath();
}

/** 侧面轮廓（Z 向前、Y 向上），可以挖洞（扳机护圈、减重孔） */
export function outline(pts: P[], holes: P[][] = []): Shape {
  const s = new Shape();
  draw(s, pts);
  for (const h of holes) {
    const p = new Path();
    draw(p, h);
    s.holes.push(p);
  }
  return s;
}

/** 把侧面轮廓沿 X 挤出 width 厚（以 x 为中心），边缘倒角 bevel */
export function side(b: Builder, shape: Shape, width: number, st: Style, bevel = 0.002, x = 0): void {
  b.extrude(shape, width, { x, ry: -Math.PI / 2 }, st, bevel);
}

/** 皮卡汀尼导轨：底座 + 一排齿，从 z0 开始长 len，顶面在 y */
export function rail(b: Builder, z0: number, len: number, y: number, st: Style, w = 0.022): void {
  b.box(w, 0.004, len, { y: y - 0.008, z: z0 + len / 2 }, st);
  const n = Math.floor(len / 0.01);
  for (let i = 0; i < n; i += 2) b.box(w, 0.004, 0.0055, { y: y - 0.004, z: z0 + 0.003 + i * 0.01 + 0.0028 }, st);
}

/** 沿 X 的销钉 / 螺丝头（两侧各一个） */
export function pin(b: Builder, y: number, z: number, r: number, halfW: number, st: Style): void {
  for (const s of [1, -1]) b.cyl(r, r, 0.0015, 10, { x: s * halfW, y, z, rz: (s * Math.PI) / 2 }, st);
}

// ---------------------------------------------------------------- 材质

export const steel = (c = 0x4c535a, o: Partial<Style> = {}): Style => ({ color: c, mat: 'metal', jitter: 0.06, ao: 0.08, aoH: 0.3, ...o });
export const dark = (c = 0x2b2e33, o: Partial<Style> = {}): Style => ({ color: c, mat: 'metal', jitter: 0.05, ao: 0.04, aoH: 0.3, ...o });
export const poly = (c = 0x1b1c1e, o: Partial<Style> = {}): Style => ({ color: c, jitter: 0.06, ao: 0.04, aoH: 0.3, ...o });
export const wood = (c = 0x6b4a2e, o: Partial<Style> = {}): Style => ({ color: c, jitter: 0.16, ao: 0.08, aoH: 0.3, ...o });
export const brass = (o: Partial<Style> = {}): Style => ({ color: 0xc09a48, mat: 'metal', jitter: 0.05, ao: 0, ...o });
export const hole = (): Style => ({ color: 0x060607, jitter: 0, ao: 0 });
export const glow = (c: number, k = 2): Style => ({ color: c, mat: 'glow', glow: k });

/** 沿 Z 的圆柱需要的旋转 */
export const Z = Math.PI / 2;
