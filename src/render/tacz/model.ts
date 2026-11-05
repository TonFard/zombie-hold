import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import type { Bone, Cube, FaceName, FaceUv, GunJson } from './types';

/**
 * 把 TACZ 的基岩版几何建成 three 的骨骼层级，坐标规则照搬 TACZ（BedrockModel / BedrockCubePerFace）：
 * - 先转成"Java 版模型空间"：单位 = 方块（1 像素 = 1/16），y 轴朝下；
 *   根骨骼位置 = (x, 24 - y, z)，子骨骼 = 相对父骨骼（y 取反）；
 * - 骨骼的旋转顺序是 Z → Y → X（three 的 'ZYX'），单位是度；
 * - 方块的东西面、上下面的贴图是对调的（Java 空间 y 朝下导致的），这里同样对调；
 * - 渲染时整体绕 Z 轴转 180° 翻回来，这一步放在视角模型里（见 gunSpace）。
 *
 * 每根骨骼每帧的变换 = 平移(静止位置 + 动画位移) · 静止旋转 · 动画旋转 · 动画缩放。
 */

const DEG = Math.PI / 180;

/** 名字带 _pos 的挂点里只有双手是要画的（画的是手臂，不是挂点上的占位方块） */
const HAND_POS = new Set(['lefthand_pos', 'righthand_pos']);

interface Node {
  bone: Bone;
  /** 静止位置（方块单位，Java 空间） */
  pos: Vector3;
  rot: Euler;
  objs: Object3D[];
}

/** 和程序模型的双臂同一套颜色（sRGB 十六进制，Color 会换算成线性值） */
const ARM_SLEEVE = new Color(0x4e5544);
const ARM_GLOVE = new Color(0x1e1f1c);

export class TaczModel {
  /** 模型根：子节点是所有根骨骼。它自己的变换由视角模型设置 */
  readonly root = new Group();
  readonly nodes = new Map<string, Node>();
  readonly material: MeshStandardMaterial;
  private readonly glowMaterial: MeshBasicMaterial;
  private readonly armMaterial: MeshStandardMaterial;
  /** 隐藏方块手臂：不画但保留几何（定位要用包围盒） */
  private readonly hiddenArm = new MeshBasicMaterial({ visible: false });

  constructor(
    readonly json: GunJson,
    texture: Texture,
  ) {
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.material = new MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.15, alphaTest: 0.5, side: DoubleSide });
    this.glowMaterial = new MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: DoubleSide, toneMapped: false });
    this.armMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: DoubleSide });

    const byName = new Map<string, Bone>();
    for (const b of json.bones) byName.set(b.name, b);
    for (const b of json.bones) {
      const parent = b.parent ? byName.get(b.parent) : undefined;
      const pos = parent
        ? new Vector3(b.pivot[0] - parent.pivot[0], parent.pivot[1] - b.pivot[1], b.pivot[2] - parent.pivot[2])
        : new Vector3(b.pivot[0], 24 - b.pivot[1], b.pivot[2]);
      pos.multiplyScalar(1 / 16);
      const r = b.rotation ?? [0, 0, 0];
      this.nodes.set(b.name, { bone: b, pos, rot: new Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'ZYX'), objs: [] });
    }
    const children = new Map<string, Bone[]>();
    for (const b of json.bones) {
      if (!b.parent || !byName.has(b.parent)) continue;
      const list = children.get(b.parent) ?? [];
      list.push(b);
      children.set(b.parent, list);
    }

    const instantiate = (b: Bone, parent: Object3D): void => {
      const n = this.nodes.get(b.name) as Node;
      const o = new Object3D();
      o.name = b.name;
      o.matrixAutoUpdate = false;
      n.objs.push(o);
      parent.add(o);
      const mesh = this.buildMesh(b);
      if (mesh) o.add(mesh);
      for (const c of children.get(b.name) ?? []) instantiate(c, o);
    };
    for (const b of json.bones) if (!b.parent || !byName.has(b.parent)) instantiate(b, this.root);

    // 备用弹匣：换弹时左手拿着的那个新弹匣。TACZ 在 additional_magazine 的位置再画一遍 magazine 的内容
    const extra = this.nodes.get('additional_magazine');
    const mag = this.nodes.get('magazine');
    if (extra && mag) {
      for (const holder of extra.objs) {
        const own = this.buildMesh(mag.bone);
        if (own) holder.add(own);
        for (const c of children.get('magazine') ?? []) instantiate(c, holder);
      }
    }

    this.setVisible('additional_magazine', false);
    // 没装配件时的默认外观
    for (const [name] of this.nodes) {
      if (name.endsWith('_pos') && !HAND_POS.has(name)) this.setVisible(name, false);
    }
    for (const name of ['mag_extended_1', 'mag_extended_2', 'mag_extended_3', 'mount', 'sight_folded', 'handguard_tactical']) this.setVisible(name, false);
    const adapter = this.nodes.get('attachment_adapter');
    if (adapter) for (const o of adapter.objs) for (const c of o.children) if (c.name) c.visible = false;
    this.setRest();
  }

  setVisible(name: string, v: boolean): void {
    const n = this.nodes.get(name);
    if (n) for (const o of n.objs) o.visible = v;
  }

  /** 所有骨骼回到静止姿态 */
  setRest(): void {
    const m = new Matrix4();
    for (const n of this.nodes.values()) {
      this.localMatrix(n, null, m);
      for (const o of n.objs) o.matrix.copy(m);
    }
  }

  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'ZYX');
  private readonly t = new Vector3();
  private readonly s = new Vector3();

  /**
   * 一根骨骼的局部矩阵。v = 动画值（位置像素 3、旋转度 3、缩放 3），null = 静止。
   * 动画位移在 Java 空间里 y 取反（TACZ 的 ModelTranslateListener）。
   */
  localMatrix(n: Node, v: ArrayLike<number> | null, out: Matrix4): Matrix4 {
    this.q.setFromEuler(n.rot);
    this.t.copy(n.pos);
    this.s.set(1, 1, 1);
    if (v) {
      this.t.x += (v[0] as number) / 16;
      this.t.y -= (v[1] as number) / 16;
      this.t.z += (v[2] as number) / 16;
      this.e.set((v[3] as number) * DEG, (v[4] as number) * DEG, (v[5] as number) * DEG, 'ZYX');
      this.qa.setFromEuler(this.e);
      this.q.multiply(this.qa);
      this.s.set(v[6] as number, v[7] as number, v[8] as number);
    }
    // 缩放为 0 时 three 的矩阵求逆会出问题，压到很小就行
    if (Math.abs(this.s.x) < 1e-4) this.s.x = 1e-4;
    if (Math.abs(this.s.y) < 1e-4) this.s.y = 1e-4;
    if (Math.abs(this.s.z) < 1e-4) this.s.z = 1e-4;
    return out.compose(this.t, this.q, this.s);
  }

  /** 从根骨骼到 name 的路径（含 name） */
  path(name: string): Node[] | null {
    let n = this.nodes.get(name);
    if (!n) return null;
    const out: Node[] = [];
    while (n) {
      out.unshift(n);
      n = n.bone.parent ? this.nodes.get(n.bone.parent) : undefined;
    }
    return out;
  }

  /**
   * 摄像机定位组（idle_view / iron_view）的反向矩阵，照搬 TACZ 的 getPositioningNodeInverse：
   * 把这个节点"移到摄像机上"。只用静止姿态（动画不影响定位）。
   */
  positioningInverse(name: string, out: Matrix4): Matrix4 | null {
    const p = this.path(name);
    if (!p) return null;
    out.identity();
    const m = new Matrix4();
    for (let i = p.length - 1; i >= 0; i--) {
      const n = p[i] as Node;
      out.multiply(m.makeRotationX(-n.rot.x));
      out.multiply(m.makeRotationY(-n.rot.y));
      out.multiply(m.makeRotationZ(-n.rot.z));
      if (i > 0) out.multiply(m.makeTranslation(-n.pos.x, -n.pos.y, -n.pos.z));
      else out.multiply(m.makeTranslation(-n.pos.x, 1.5 - n.pos.y, -n.pos.z));
    }
    return out;
  }

  // ---------------------------------------------------------------- 几何

  private buildMesh(b: Bone): Mesh | null {
    if (!b.cubes?.length) return null;
    const arm = HAND_POS.has(b.name);
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const W = this.json.texture.w;
    const H = this.json.texture.h;
    const m = new Matrix4();
    const v = new Vector3();
    const nv = new Vector3();
    for (const c of b.cubes) {
      // 带旋转的方块：TACZ 给它单独建一个以方块 pivot 为原点的子部件
      let x: number;
      let y: number;
      let z: number;
      if (c.rotation) {
        const cp = c.pivot ?? b.pivot;
        x = c.origin[0] - cp[0];
        y = cp[1] - c.origin[1] - c.size[1];
        z = c.origin[2] - cp[2];
        const e = new Euler(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG, 'ZYX');
        m.compose(new Vector3((cp[0] - b.pivot[0]) / 16, (b.pivot[1] - cp[1]) / 16, (cp[2] - b.pivot[2]) / 16), new Quaternion().setFromEuler(e), new Vector3(1, 1, 1));
      } else {
        x = c.origin[0] - b.pivot[0];
        y = b.pivot[1] - c.origin[1] - c.size[1];
        z = c.origin[2] - b.pivot[2];
        m.identity();
      }
      const quads = cubeQuads(c, x, y, z, W, H);
      for (const q of quads) {
        nv.set(q.n[0], q.n[1], q.n[2]).transformDirection(m);
        const base = pos.length / 3;
        for (let i = 0; i < 4; i++) {
          const p = q.v[i] as [number, number, number];
          v.set(p[0] / 16, p[1] / 16, p[2] / 16).applyMatrix4(m);
          pos.push(v.x, v.y, v.z);
          nor.push(nv.x, nv.y, nv.z);
          const t = q.uv[i] as [number, number];
          uv.push(t[0], t[1]);
          if (arm) {
            // 手臂占位方块和原版手臂（翻转 180° 后）重合：Java 空间 y 小的那头是手，画手套，其余是袖子
            const glove = p[1] < y + 4.5;
            const k = glove ? ARM_GLOVE : ARM_SLEEVE;
            col.push(k.r, k.g, k.b);
          }
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    if (arm) g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const mat = arm ? this.armMaterial : b.name.endsWith('_illuminated') ? this.glowMaterial : this.material;
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    // 方块手臂只用来定位，由视角模型换成程序手臂（见 TaczRig.handEnds）
    if (arm) mesh.material = this.hiddenArm;
    return mesh;
  }

  dispose(): void {
    this.root.traverse((o) => {
      (o as Mesh).geometry?.dispose();
    });
    this.material.map?.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
    this.armMaterial.dispose();
    this.hiddenArm.dispose();
  }
}

interface Quad {
  v: Array<[number, number, number]>;
  uv: Array<[number, number]>;
  n: [number, number, number];
}

type Dir = 'down' | 'up' | 'west' | 'north' | 'east' | 'south';
const NORMAL: Record<Dir, [number, number, number]> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  west: [-1, 0, 0],
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
};
/** TACZ 的 FaceUVsItem.getFace：Java 空间里的东 / 西、上 / 下取的是基岩版里对面的贴图 */
const FACE_OF: Record<Dir, FaceName> = { east: 'west', west: 'east', up: 'down', down: 'up', north: 'north', south: 'south' };

/** 一个方块的 6 个面（顶点在 Java 空间、像素单位），和 BedrockCubePerFace / BedrockCubeBox 一致 */
function cubeQuads(c: Cube, x0: number, y0: number, z0: number, W: number, H: number): Quad[] {
  const d = c.inflate ?? 0;
  let x = x0 - d;
  const y = y0 - d;
  const z = z0 - d;
  let X = x0 + c.size[0] + d;
  const Y = y0 + c.size[1] + d;
  const Z = z0 + c.size[2] + d;
  const box = Array.isArray(c.uv);
  const mirror = box && !!c.mirror;
  if (mirror) [x, X] = [X, x];
  const v1: [number, number, number] = [x, y, z];
  const v2: [number, number, number] = [X, y, z];
  const v3: [number, number, number] = [X, Y, z];
  const v4: [number, number, number] = [x, Y, z];
  const v5: [number, number, number] = [x, y, Z];
  const v6: [number, number, number] = [X, y, Z];
  const v7: [number, number, number] = [X, Y, Z];
  const v8: [number, number, number] = [x, Y, Z];
  const verts: Record<Dir, Array<[number, number, number]>> = {
    down: [v6, v5, v1, v2],
    up: [v3, v4, v8, v7],
    west: [v1, v5, v8, v4],
    north: [v2, v1, v4, v3],
    east: [v6, v2, v3, v7],
    south: [v5, v6, v7, v8],
  };

  // 每个面的贴图矩形 (u1, v1) – (u2, v2)，像素
  const rect: Partial<Record<Dir, [number, number, number, number]>> = {};
  if (box) {
    const [ox, oy] = c.uv as [number, number];
    const dx = Math.trunc(c.size[0]);
    const dy = Math.trunc(c.size[1]);
    const dz = Math.trunc(c.size[2]);
    const p1 = ox + dz;
    const p2 = ox + dz + dx;
    const p3 = ox + dz + dx + dx;
    const p4 = ox + dz + dx + dz;
    const p5 = ox + dz + dx + dz + dx;
    const p6 = oy + dz;
    const p7 = oy + dz + dy;
    const p8 = oy;
    const p9 = ox;
    rect.down = [p1, p8, p2, p6];
    rect.up = [p2, p6, p3, p8];
    rect.west = [p9, p6, p1, p7];
    rect.north = [p1, p6, p2, p7];
    rect.east = [p2, p6, p4, p7];
    rect.south = [p4, p6, p5, p7];
  } else {
    const faces = c.uv as Partial<Record<FaceName, FaceUv>>;
    for (const dir of Object.keys(verts) as Dir[]) {
      const f = faces[FACE_OF[dir]];
      if (!f) continue;
      rect[dir] = [f.uv[0], f.uv[1], f.uv[0] + f.uv_size[0], f.uv[1] + f.uv_size[1]];
    }
  }

  const out: Quad[] = [];
  for (const dir of Object.keys(verts) as Dir[]) {
    const r = rect[dir];
    if (!r) continue;
    const [u1, vv1, u2, vv2] = r;
    let vs = verts[dir];
    // BedrockPolygon：顶点 0..3 依次对应 (u2,v1) (u1,v1) (u1,v2) (u2,v2)；three 的贴图 v 轴朝上，所以取 1 - v
    let uvs: Array<[number, number]> = [
      [u2 / W, 1 - vv1 / H],
      [u1 / W, 1 - vv1 / H],
      [u1 / W, 1 - vv2 / H],
      [u2 / W, 1 - vv2 / H],
    ];
    let n = NORMAL[dir];
    if (mirror) {
      vs = [...vs].reverse();
      uvs = [...uvs].reverse();
      n = [-n[0], n[1], n[2]];
    }
    out.push({ v: vs, uv: uvs, n });
  }
  return out;
}

/** 测试 / 预览用：一张 1×1 的灰色贴图，贴图还没加载好时先顶上 */
export function placeholderTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#777';
  ctx.fillRect(0, 0, 1, 1);
  return new CanvasTexture(c);
}
