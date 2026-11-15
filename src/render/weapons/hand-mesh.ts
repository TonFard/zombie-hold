import {
  Bone,
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Quaternion,
  RepeatWrapping,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
} from 'three';

/**
 * 第一人称手臂的网格：一整张蒙皮网格（前臂的袖子、手套、四根三节的手指、带大鱼际的拇指），全部在代码里放样出来。
 *
 * 尺寸按真人（米）：手掌宽 8.6 厘米、手腕关节到中指指根 10.5 厘米、中指 9.3 厘米、手腕 6.5 × 5 厘米、肘到手腕 25 厘米。
 * 手套坐标：原点在手心，+Z = 手指方向，-Y = 掌心（手指往 -Y 弯），拇指在 +X（右手）/ -X（左手）那侧。
 *
 * 以前是「圆角盒子当手掌 + 圆柱当手指」，关节处靠球遮缝，近看像机器人；现在每根手指是一根连续的管子，
 * 关节两侧的顶点按权重跟两节骨头走，弯起来是圆的；手掌的截面从手腕（窄而厚）渐变到指根（宽而扁）。
 */

/** 手心到手腕关节的距离 */
export const WRIST = 0.055;
/** 手掌的厚度、长度（掌面在 y = -PALM_T / 2，四指根部在 z ≈ PALM_L / 2 - 0.004） */
export const PALM_T = 0.03;
export const PALM_L = 0.1;
/** 绑定姿势里前臂的长度（肘 → 手腕关节） */
export const FORE_BIND = 0.25;

const DEG = Math.PI / 180;

/** 手指弯曲（弧度，curl = 1 时）：掌指关节 / 中间关节 / 指尖关节 */
const CURL = [0.85, 0.95, 0.5] as const;
/** 拇指第一节的默认朝向：往手指那边收（绕手背法线）、往掌心那边压 */
const THUMB_RY = -0.6;
const THUMB_RX = 0.4;

interface FingerDef {
  /** 指根离手掌中线多远（正 = 拇指那侧）、沿手指方向的位置 */
  x: number;
  z: number;
  /** 指根处的半宽 */
  r: number;
  len: readonly [number, number, number];
  /** 放松时往外张多少度（正 = 往拇指那侧） */
  splay: number;
}

/** 四根手指，食指排第一。指根连线是条弧线：中指最靠前，小指最靠后 */
export const FINGERS: readonly FingerDef[] = [
  { x: 0.0318, z: 0.0455, r: 0.0103, len: [0.04, 0.024, 0.0215], splay: 4 },
  { x: 0.0106, z: 0.0495, r: 0.0106, len: [0.044, 0.027, 0.022], splay: 1 },
  { x: -0.0106, z: 0.0465, r: 0.0101, len: [0.041, 0.025, 0.0215], splay: -2 },
  { x: -0.0312, z: 0.0395, r: 0.0091, len: [0.032, 0.019, 0.0195], splay: -6 },
];
/** 手指的中轴比手掌中面略靠掌心 */
const FINGER_Y = -0.0015;
/** 指根连线（右手坐标）：x 处的指根在 z 多少；最靠前的是中指 */
const KNUCKLE_MAX = 0.0495;
const knuckleZ = (x: number): number =>
  curve(
    [
      [-0.044, 0.0355],
      [-0.0312, 0.0395],
      [-0.0106, 0.0465],
      [0.0106, 0.0495],
      [0.0318, 0.0455],
      [0.044, 0.042],
    ],
    x,
  );

/**
 * 拇指（右手坐标）：掌骨根在手腕前面一点、偏掌心，绑定姿势里三节沿 THUMB_DIR 伸直；指肚朝着 THUMB_IN（掌心前面那一点）。
 * 掌骨那一节整个埋在手掌的轮廓里（从手背看不到，掌心那侧鼓出来就是大鱼际），露在外面的只有后两节
 */
const THUMB_AT = new Vector3(0.02, -0.008, -0.036);
const THUMB_DIR = new Vector3(0.55, -0.25, 0.8).normalize();
const THUMB_LEN = [0.044, 0.031, 0.027] as const;
const THUMB_IN = new Vector3(0, -0.03, 0.035);
/** 拇指的半宽：第二节根部、指尖那节根部 */
export const THUMB_R = [0.0146, 0.0134] as const;
/** 虎口（拇指和食指之间那片皮）接在手掌上的位置：食指根的外侧 */
const WEB_AT = new Vector3(0.034, -0.005, 0.026);

// 颜色（sRGB）
const C_SLEEVE = new Color(0x4e5544);
const C_SLEEVE_DARK = new Color(0x3b4134);
const C_BACK = new Color(0x3d4043);
const C_PALM = new Color(0x242422);
const C_GUSSET = new Color(0x4a4e52);
const C_CUFF = new Color(0x1f2123);
const C_STRAP = new Color(0x3a3e42);
const C_GUARD = new Color(0x17181a);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** 折线插值：keys = [位置, 值]，位置升序 */
function curve(keys: ReadonlyArray<readonly [number, number]>, x: number): number {
  let prev = keys[0] as readonly [number, number];
  if (x <= prev[0]) return prev[1];
  for (const k of keys) {
    if (x <= k[0]) return prev[1] + ((k[1] - prev[1]) * (x - prev[0])) / (k[0] - prev[0] || 1);
    prev = k;
  }
  return prev[1];
}

const _c = new Color();
const mix = (a: Color, b: Color, t: number): Color => _c.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

/** 攒顶点：一圈圈截面连成管子，带蒙皮权重、顶点色、贴图坐标 */
class Acc {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly idx: number[] = [];
  /** 每一圈首尾两个重合的顶点（贴图接缝）：算完法线要把这两个点的法线取平均，不然接缝处有一道棱 */
  readonly seams: Array<[number, number]> = [];

  /**
   * n 个截面、每圈 segs 段的管子。at(i, 角度, out) 把第 i 个截面上这个角度的点写进 out、返回颜色；
   * skin(i) = [骨头甲, 骨头乙, 乙的权重]；vOf(i) = 贴图的纵向坐标；uRep = 绕一圈贴图重复几次
   */
  tube(n: number, segs: number, uRep: number, vOf: (i: number) => number, at: (i: number, t: number, out: Vector3) => Color, skin: (i: number) => readonly [number, number, number]): void {
    const base = this.pos.length / 3;
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      const [b0, b1, w1] = skin(i);
      for (let k = 0; k <= segs; k++) {
        const c = at(i, ((k % segs) / segs) * Math.PI * 2, p);
        this.pos.push(p.x, p.y, p.z);
        this.col.push(c.r, c.g, c.b);
        this.uv.push((k / segs) * uRep, vOf(i));
        this.si.push(b0, b1, 0, 0);
        this.sw.push(1 - w1, w1, 0, 0);
      }
      this.seams.push([base + i * (segs + 1), base + i * (segs + 1) + segs]);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < segs; k++) {
        const a = base + i * (segs + 1) + k;
        const d = a + segs + 1;
        this.idx.push(a, a + 1, d + 1, a, d + 1, d);
      }
    }
  }

  /** 椭球（指节护甲、手指背上的护条）：整个绑在一根骨头上。ax / ay / az = 三个半轴（已经带方向和长度） */
  blob(center: Vector3, ax: Vector3, ay: Vector3, az: Vector3, bone: number, color: Color, lat = 6, segs = 10): void {
    this.tube(
      lat + 1,
      segs,
      1,
      (i) => i / lat,
      (i, t, out) => {
        const phi = (i / lat) * Math.PI;
        const rr = Math.max(0.02, Math.sin(phi));
        out.copy(center).addScaledVector(az, -Math.cos(phi)).addScaledVector(ax, Math.cos(t) * rr).addScaledVector(ay, Math.sin(t) * rr);
        return color;
      },
      () => [bone, bone, 0],
    );
  }

  build(skinned: boolean): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    if (skinned) {
      g.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    }
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const nor = g.getAttribute('normal');
    const a = new Vector3();
    const b = new Vector3();
    for (const [i, j] of this.seams) {
      a.fromBufferAttribute(nor, i);
      b.fromBufferAttribute(nor, j);
      a.add(b).normalize();
      nor.setXYZ(i, a.x, a.y, a.z);
      nor.setXYZ(j, a.x, a.y, a.z);
    }
    return g;
  }
}

/** 织物的法线贴图（平纹，1.2 厘米一个循环）：手套、袖子近看有布纹，不是一片塑料 */
let weaveTex: CanvasTexture | null = null;
function weave(): CanvasTexture {
  if (weaveTex) return weaveTex;
  const S = 64;
  const T = 8;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = Math.sin((Math.PI * (x % T)) / T);
      const v = Math.sin((Math.PI * (y % T)) / T);
      const over = (Math.floor(x / T) + Math.floor(y / T)) % 2 === 0;
      h[y * S + x] = over ? u * (0.55 + 0.45 * v) : v * (0.55 + 0.45 * u);
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(S, S);
  const at = (x: number, y: number): number => h[((y + S) % S) * S + ((x + S) % S)] as number;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.6;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.6;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      img.data[o] = Math.round((-dx / l) * 127.5 + 127.5);
      img.data[o + 1] = Math.round((dy / l) * 127.5 + 127.5);
      img.data[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  weaveTex = t;
  return t;
}

let armMat: MeshStandardMaterial | null = null;
/** 手臂共用的材质：顶点色分出袖子 / 手套的各块面料，法线贴图给布纹 */
export function armMaterial(): MeshStandardMaterial {
  if (armMat) return armMat;
  armMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 });
  // 没有 document（跑测试）时不做贴图
  if (typeof document !== 'undefined') {
    armMat.normalMap = weave();
    armMat.normalScale = new Vector2(0.55, 0.55);
  }
  return armMat;
}

/** 贴图一个循环对应多少米 */
const TILE = 0.012;
const uRepOf = (r: number): number => Math.max(1, Math.round((2 * Math.PI * r) / TILE));

/** 袖子上的褶皱（米）：几道斜着绕的波叠在一起 */
const wrinkle = (z: number, t: number): number => {
  // 褶子不是一圈圈均匀的：有的地方深、有的地方平
  const k = 0.55 + 0.45 * Math.sin(31 * z + t + 0.7);
  return k * (0.0011 * Math.sin(118 * z + 2 * t + 1.3) + 0.0009 * Math.sin(197 * z - 3 * t + 0.4)) + 0.0006 * Math.sin(71 * z + t + 2.1);
};

// 骨头编号
const B_FORE = 0;
const B_HAND = 1;
const B_FINGER = 2;
const B_THUMB = B_FINGER + FINGERS.length * 3;

/** 手套（从袖口里面一直到指根）的截面：[z, 半宽, 手背侧半厚, 掌心侧半厚] */
const BODY: ReadonlyArray<readonly [number, number, number, number]> = [
  [-0.105, 0.0318, 0.0268, 0.0268],
  [-0.08, 0.0325, 0.026, 0.0256],
  [-0.062, 0.0325, 0.0246, 0.0242],
  [-0.05, 0.0338, 0.0228, 0.0232],
  [-0.038, 0.0368, 0.0204, 0.0215],
  [-0.02, 0.0405, 0.018, 0.0192],
  [0, 0.0424, 0.0162, 0.016],
  [0.018, 0.0432, 0.0152, 0.0148],
  [0.035, 0.0432, 0.0147, 0.0141],
  [0.046, 0.0424, 0.0133, 0.0124],
  // 指根那头收圆
  [0.0505, 0.0412, 0.0102, 0.0096],
  [0.0538, 0.0388, 0.006, 0.0056],
  [0.0552, 0.0356, 0.0016, 0.0016],
];

/** 一根手指 / 拇指：沿 dir 伸直的管子，nail = 指背方向。lens = 三节的长度，rad(z) = 这个位置的半宽 */
function digit(acc: Acc, origin: Vector3, dir: Vector3, nail: Vector3, lens: readonly [number, number, number], rad: (z: number) => number, start: number, bones: readonly [number, number, number, number], zones: readonly [number, number, number], thick: number, rootTo = zones[0] * 0.8): void {
  const y = nail.clone().addScaledVector(dir, -nail.dot(dir)).normalize();
  const x = new Vector3().crossVectors(y, dir);
  const L = lens[0] + lens[1] + lens[2];
  const rt = rad(L) * 0.95;
  const zs: number[] = [];
  for (let z = start; z < L - rt - 0.001; z += 0.0042) zs.push(z);
  // 指尖收成半球，越靠尖截面越密
  for (const f of [0, 0.3, 0.55, 0.75, 0.9, 0.98, 1]) zs.push(L - rt + rt * f);
  const j1 = lens[0];
  const j2 = lens[0] + lens[1];
  const scaleAt = (z: number): number => (z <= L - rt ? 1 : Math.sqrt(Math.max(0.0016, 1 - ((z - (L - rt)) / rt) ** 2)));
  acc.tube(
    zs.length,
    12,
    uRepOf(rad(0)),
    (i) => (zs[i] as number) / TILE,
    (i, t, out) => {
      const z = zs[i] as number;
      // 关节处略鼓
      const g1 = Math.exp(-(((z - j1) / 0.006) ** 2));
      const g2 = Math.exp(-(((z - j2) / 0.005) ** 2));
      const w = rad(z) * (1 + 0.07 * g1 + 0.06 * g2) * scaleAt(z);
      const sn = Math.sin(t);
      // 指背上关节的骨节再凸一点；指肚那侧每一节中间有肉垫
      const pad = Math.sin(Math.PI * clamp01((z - j1) / lens[1])) * 0.05 + Math.sin(Math.PI * clamp01(z / j1)) * 0.04;
      const extra = sn > 0 ? sn * (0.1 * g1 + 0.08 * g2) : -sn * pad;
      out.copy(origin).addScaledVector(dir, z).addScaledVector(x, Math.cos(t) * w).addScaledVector(y, sn * w * (thick + extra));
      // 指背是面料、指肚是掌心那种皮料，两侧一条拼缝
      return sn > 0.3 ? C_BACK : sn < -0.25 ? C_PALM : C_GUSSET;
    },
    (i) => {
      const z = zs[i] as number;
      if (z < j1 * 0.5 || z < rootTo) return [bones[0], bones[1], smooth(-zones[0], rootTo, z)];
      if (z < j1 + lens[1] * 0.5) return [bones[1], bones[2], smooth(j1 - zones[1], j1 + zones[1], z)];
      return [bones[2], bones[3], smooth(j2 - zones[2], j2 + zones[2], z)];
    },
  );
}

/** 朝 dir、指背朝 nail 的朝向（x = y × z） */
function frame(dir: Vector3, nail: Vector3, out: Quaternion): Quaternion {
  const y = _fy.copy(nail).addScaledVector(dir, -nail.dot(dir)).normalize();
  const x = _fx.crossVectors(y, dir);
  return out.setFromRotationMatrix(_fm.makeBasis(x, y, dir));
}
const _fx = new Vector3();
const _fy = new Vector3();
const _fm = new Matrix4();

const _bend = new Vector3();
/**
 * 拇指的姿势（右手坐标）：三节的方向 d0（掌骨）/ d1 / d2、指背朝向 nail。
 * 第二节朝 thumb / thumbUp 定的方向；掌骨（大鱼际）只跟着转四成；指尖那节再往指肚那侧扣一点
 */
function thumbPose(thumbOpen: number, thumbUp: number, d0: Vector3, d1: Vector3, d2: Vector3, nail: Vector3): void {
  const tx = THUMB_RX + thumbUp * DEG;
  const ty = THUMB_RY + thumbOpen * DEG;
  d1.set(Math.sin(ty) * Math.cos(tx), -Math.sin(tx), Math.cos(ty) * Math.cos(tx));
  d0.copy(THUMB_DIR).lerp(d1, 0.4).normalize();
  nail.copy(THUMB_AT).addScaledVector(d0, THUMB_LEN[0]).sub(THUMB_IN);
  _bend.copy(nail).addScaledVector(d1, -nail.dot(d1)).normalize().negate();
  const phi = 0.38 * (1 - 0.7 * Math.min(1, Math.max(0, thumbOpen / 90)));
  d2.copy(d1).multiplyScalar(Math.cos(phi)).addScaledVector(_bend, Math.sin(phi));
}

/**
 * 给定 thumb / thumbUp，拇指各关节在手套坐标里的位置（米，右手；左手把 x 取反）：mcp = 露出手掌的那一节的根部，
 * ip = 指尖那节的根部，tip = 指尖。调手的工具用它算「拇指贴着枪的哪里」
 */
export function thumbJoints(thumbOpen: number, thumbUp: number): { mcp: number[]; ip: number[]; tip: number[] } {
  const d0 = new Vector3();
  const d1 = new Vector3();
  const d2 = new Vector3();
  thumbPose(thumbOpen, thumbUp, d0, d1, d2, new Vector3());
  const mcp = THUMB_AT.clone().addScaledVector(d0, THUMB_LEN[0]);
  const ip = mcp.clone().addScaledVector(d1, THUMB_LEN[1]);
  const tip = ip.clone().addScaledVector(d2, THUMB_LEN[2]);
  return { mcp: mcp.toArray(), ip: ip.toArray(), tip: tip.toArray() };
}

/** 反过来：想让拇指第二节朝 dir（手套坐标，右手），thumb / thumbUp 该是多少度 */
export function thumbAngles(dir: Vector3): { thumb: number; thumbUp: number } {
  const d = dir.clone().normalize();
  const tx = Math.asin(Math.min(1, Math.max(-1, -d.y)));
  const ty = Math.atan2(d.x, d.z);
  return { thumb: (ty - THUMB_RY) / DEG, thumbUp: (tx - THUMB_RX) / DEG };
}

export interface ArmRig {
  mesh: SkinnedMesh;
  /** 前臂：原点在肘，+Z 指向手腕 */
  fore: Bone;
  /** 手：手套坐标 */
  hand: Bone;
  /** 四根手指（食指排第一）各三节骨头 */
  fingers: Bone[][];
  thumb: Bone[];
  setGrip(curl: number, thumb: number, tip: number, index: number, thumbUp: number): void;
}

/** 一条手臂（肘以下）的蒙皮网格和骨头。骨头 fore / hand 要由调用方挂到同一个父节点下、每帧摆好 */
export function buildArm(left: boolean): ArmRig {
  const s = left ? -1 : 1;
  const acc = new Acc();
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  const Z = new Vector3(0, 0, 1);

  // ---- 袖子：肘到手腕，带褶皱，末端是一圈袖口
  const zE = -(WRIST + FORE_BIND);
  const zCuff = -0.083;
  const sleeveR = (z: number): number =>
    curve(
      [
        [zE, 0.047],
        [zE + 0.05, 0.0495],
        [zE + 0.13, 0.0455],
        [-0.119, 0.0402],
        [zCuff, 0.0405],
      ],
      z,
    );
  const cuffK = (z: number): number => smooth(-0.127, -0.117, z);
  const sz: number[] = [];
  for (let z = zE; z < zCuff - 0.002; z += 0.0075) sz.push(z);
  sz.push(zCuff);
  const sleeveAt = (z: number, t: number, r: number, out: Vector3): void => {
    // 靠手腕那头略扁，靠肘那头是圆的
    const flat = 1 - 0.13 * smooth(zE + 0.08, zCuff, z);
    out.set(Math.cos(t) * r, Math.sin(t) * r * flat + 0.001, z);
  };
  acc.tube(
    sz.length,
    20,
    uRepOf(0.045),
    (i) => (sz[i] as number) / TILE,
    (i, t, out) => {
      const z = sz[i] as number;
      const k = cuffK(z);
      const w = wrinkle(z, t) * (1 - 0.8 * k);
      sleeveAt(z, t, sleeveR(z) + w + 0.0012 * k, out);
      // 褶皱的谷里暗一点；袖口那一圈是深色滚边
      return mix(_c2.copy(C_SLEEVE).multiplyScalar(0.94 + 28 * w), C_SLEEVE_DARK, k * 0.85);
    },
    () => [B_FORE, B_FORE, 0],
  );
  // 肘：一个球，上臂和前臂弯成什么角度都接得上
  acc.blob(new Vector3(0, 0, zE), X.clone().multiplyScalar(0.0505), Y.clone().multiplyScalar(0.0505), Z.clone().multiplyScalar(0.0505), B_FORE, C_SLEEVE, 8, 14);
  // 袖口的厚度：外沿 → 内沿 → 往里一段
  const rim: Array<[number, number]> = [
    [zCuff, 0.0417],
    [zCuff + 0.0012, 0.0395],
    [zCuff, 0.0362],
    [zCuff - 0.02, 0.0358],
  ];
  acc.tube(
    rim.length,
    20,
    uRepOf(0.045),
    (i) => i * 0.2,
    (i, t, out) => {
      const [z, r] = rim[i] as [number, number];
      sleeveAt(z, t, r, out);
      return i < 2 ? C_SLEEVE_DARK : _c2.copy(C_SLEEVE_DARK).multiplyScalar(0.45);
    },
    () => [B_FORE, B_FORE, 0],
  );

  // ---- 手套：手腕（袖口里面）→ 手掌 → 指根收圆
  const bz: number[] = [];
  for (let z = -0.105; z < 0.0455; z += 0.0055) bz.push(z);
  for (const k of BODY) if (k[0] >= 0.046) bz.push(k[0]);
  const keysA = BODY.map((k) => [k[0], k[1]] as const);
  const keysB = BODY.map((k) => [k[0], k[2]] as const);
  const keysP = BODY.map((k) => [k[0], k[3]] as const);
  // 小鱼际（掌根靠小指那侧的肉）朝哪个角度鼓
  const hypo = left ? 315 * DEG : 225 * DEG;
  acc.tube(
    bz.length,
    24,
    uRepOf(0.03),
    (i) => (bz[i] as number) / TILE,
    (i, t, out) => {
      const z = bz[i] as number;
      const a = curve(keysA, z);
      const cs = Math.cos(t);
      const sn = Math.sin(t);
      const b = sn >= 0 ? curve(keysB, z) : curve(keysP, z);
      // 手腕是椭圆，手掌更方一点（超椭圆）
      const e = 2 / (2 + 0.7 * smooth(-0.05, -0.005, z));
      let px = a * Math.sign(cs) * Math.abs(cs) ** e;
      let py = b * Math.sign(sn) * Math.abs(sn) ** e;
      const bump = 0.0034 * Math.exp(-(((z + 0.022) / 0.02) ** 2)) * Math.max(0, Math.cos(t - hypo)) ** 2;
      // 手腕上的魔术贴束带：略高出一圈
      const strap = smooth(-0.077, -0.074, z) * (1 - smooth(-0.057, -0.054, z));
      const grow = bump + 0.0016 * strap;
      px += cs * grow;
      py += sn * grow;
      // 手掌靠手指的那条边跟着指根的弧线走（小指那侧比中指短一厘米），不然小指弯下去时指根前面多出一块台阶
      const zz = z + (knuckleZ(px * s) - KNUCKLE_MAX) * smooth(0.0, 0.046, z);
      out.set(px, py - 0.001 * smooth(-0.07, -0.03, z), zz);
      if (strap > 0.5) return C_STRAP;
      if (z < -0.054) return C_CUFF;
      return sn > 0.22 ? C_BACK : sn < -0.2 ? C_PALM : C_GUSSET;
    },
    (i) => [B_FORE, B_HAND, smooth(-0.08, -0.034, bz[i] as number)],
  );

  // ---- 四根手指
  const origin = new Vector3();
  const dir = new Vector3();
  FINGERS.forEach((f, fi) => {
    const sp = f.splay * DEG;
    origin.set(f.x * s, FINGER_Y, f.z);
    dir.set(Math.sin(sp) * s, 0, Math.cos(sp));
    const L = f.len[0] + f.len[1] + f.len[2];
    const b = B_FINGER + fi * 3;
    digit(acc, origin, dir, Y, f.len, (z) => f.r * (1.03 - 0.16 * Math.max(0, z) / L), -0.016, [B_HAND, b, b + 1, b + 2], [0.01, 0.007, 0.006], 0.9);
    // 指背上的护条（第一节）
    const y = Y;
    const x = new Vector3().crossVectors(y, dir);
    acc.blob(origin.clone().addScaledVector(dir, f.len[0] * 0.52).addScaledVector(y, f.r * 0.86), x.clone().multiplyScalar(f.r * 0.62), y.clone().multiplyScalar(0.0032), dir.clone().multiplyScalar(f.len[0] * 0.27), b, C_GUARD);
    // 指节护甲：每个指根一个鼓包
    acc.blob(new Vector3(f.x * s, 0.0128, f.z - 0.0075), X.clone().multiplyScalar(0.0096), Y.clone().multiplyScalar(0.0062), Z.clone().multiplyScalar(0.012), B_HAND, C_GUARD);
  });
  // 护甲的底板
  acc.blob(new Vector3(0, 0.0128, 0.034), X.clone().multiplyScalar(0.0395), Y.clone().multiplyScalar(0.0038), Z.clone().multiplyScalar(0.0135), B_HAND, C_GUARD);

  // ---- 拇指（绑定姿势里沿 THUMB_DIR 伸直）
  const tAt = new Vector3(THUMB_AT.x * s, THUMB_AT.y, THUMB_AT.z);
  const tDir = new Vector3(THUMB_DIR.x * s, THUMB_DIR.y, THUMB_DIR.z);
  const tNail = new Vector3().copy(THUMB_AT).addScaledVector(THUMB_DIR, THUMB_LEN[0]).sub(THUMB_IN);
  tNail.x *= s;
  const thumbR = (z: number): number =>
    curve(
      [
        [-0.012, 0.0185],
        [0.012, 0.0192],
        [THUMB_LEN[0] - 0.004, 0.015],
        [THUMB_LEN[0] + 0.006, THUMB_R[0]],
        [THUMB_LEN[0] + THUMB_LEN[1], THUMB_R[1]],
        [THUMB_LEN[0] + THUMB_LEN[1] + THUMB_LEN[2], 0.0122],
      ],
      z,
    );
  // 掌骨那一节（大鱼际）靠手腕的大半段主要还是跟着手掌，越往拇指根越跟着掌骨
  digit(acc, tAt, tDir, tNail, THUMB_LEN, thumbR, -0.012, [B_HAND, B_THUMB, B_THUMB + 1, B_THUMB + 2], [0.012, 0.008, 0.007], 0.86, 0.03);
  // 虎口：从食指根外侧拉到拇指第二节根部的一片扁的皮，一头跟手掌、一头跟拇指，拇指张开它就被拉开
  {
    const a = new Vector3(WEB_AT.x * s, WEB_AT.y, WEB_AT.z);
    const b = tAt.clone().addScaledVector(tDir, THUMB_LEN[0] + 0.008);
    const d = b.clone().sub(a).normalize();
    const e2 = new Vector3().crossVectors(d, tDir).normalize();
    const e1 = new Vector3().crossVectors(e2, d);
    const n = 7;
    acc.tube(
      n + 1,
      10,
      uRepOf(0.01),
      (i) => (i / n) * 3,
      (i, t, out) => {
        const u = i / n;
        const w1 = 0.013 - 0.002 * u;
        const w2 = 0.0075 + 0.0015 * Math.abs(u - 0.5);
        const cs = Math.cos(t);
        const sn = Math.sin(t);
        out.copy(a).lerp(b, u).addScaledVector(e1, cs * w1).addScaledVector(e2, sn * w2);
        const ny = e1.y * cs + e2.y * sn;
        return ny > 0.3 ? C_BACK : ny < -0.25 ? C_PALM : C_GUSSET;
      },
      (i) => [B_HAND, B_THUMB + 1, smooth(0.1, 0.9, i / n)],
    );
  }

  // ---- 骨头（绑定姿势）
  const fore = new Bone();
  fore.position.set(0, 0, zE);
  const hand = new Bone();
  const bones: Bone[] = [fore, hand];
  const fingers: Bone[][] = [];
  for (const f of FINGERS) {
    const p1 = new Bone();
    p1.position.set(f.x * s, FINGER_Y, f.z);
    p1.rotation.set(0, f.splay * DEG * s, 0, 'YXZ');
    const p2 = new Bone();
    p2.position.z = f.len[0];
    const p3 = new Bone();
    p3.position.z = f.len[1];
    p2.add(p3);
    p1.add(p2);
    hand.add(p1);
    fingers.push([p1, p2, p3]);
    bones.push(p1, p2, p3);
  }
  const t0 = new Bone();
  t0.position.copy(tAt);
  frame(tDir, tNail, t0.quaternion);
  const t1 = new Bone();
  t1.position.z = THUMB_LEN[0];
  const t2 = new Bone();
  t2.position.z = THUMB_LEN[1];
  t1.add(t2);
  t0.add(t1);
  hand.add(t0);
  const thumb = [t0, t1, t2];
  bones.push(t0, t1, t2);
  fore.updateMatrixWorld(true);
  hand.updateMatrixWorld(true);

  const mesh = new SkinnedMesh(acc.build(true), armMaterial());
  mesh.bind(new Skeleton(bones), new Matrix4());
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // ---- 手指 / 拇指的姿势
  const e = new Euler(0, 0, 0, 'YXZ');
  const D = new Vector3();
  const d0 = new Vector3();
  const d2 = new Vector3();
  const nail = new Vector3();
  const q0 = new Quaternion();
  const q1 = new Quaternion();
  const q2 = new Quaternion();
  let key = '';
  const setGrip = (curl: number, thumbOpen: number, tip: number, index: number, thumbUp: number): void => {
    const k = `${curl},${thumbOpen},${tip},${index},${thumbUp}`;
    if (k === key) return;
    key = k;
    fingers.forEach((f, i) => {
      const c = i === 0 ? curl * index : curl;
      // 握起来的时候手指并拢
      const spread = (FINGERS[i] as FingerDef).splay * DEG * (1 - 0.7 * Math.min(1, Math.max(0, c)));
      (f[0] as Bone).quaternion.setFromEuler(e.set(CURL[0] * c, spread * s, 0, 'YXZ'));
      (f[1] as Bone).rotation.x = CURL[1] * c * tip;
      (f[2] as Bone).rotation.x = CURL[2] * c * tip;
    });
    thumbPose(thumbOpen, thumbUp, d0, D, d2, nail);
    // 左手：左右镜像
    D.x *= s;
    d0.x *= s;
    d2.x *= s;
    nail.x *= s;
    frame(d0, nail, q0);
    frame(D, nail, q1);
    frame(d2, nail, q2);
    t0.quaternion.copy(q0);
    t1.quaternion.copy(q0).invert().multiply(q1);
    t2.quaternion.copy(q1).invert().multiply(q2);
  };
  setGrip(1, 0, 1, 1, 0);
  return { mesh, fore, hand, fingers, thumb, setGrip };
}
const _c2 = new Color();

/** 上臂的袖子：沿 +Z 长度为 1 的管子（用 scale.z 拉到需要的长度），带褶皱 */
export function upperSleeve(): Mesh {
  const acc = new Acc();
  const n = 14;
  acc.tube(
    n + 1,
    18,
    uRepOf(0.05),
    (i) => (i / n) * 24,
    (i, t, out) => {
      const z = i / n;
      const w = wrinkle(z * 0.3, t);
      const r = 0.058 - 0.009 * z + w;
      out.set(Math.cos(t) * r, Math.sin(t) * r, z);
      return _c2.copy(C_SLEEVE).multiplyScalar(0.94 + 28 * w);
    },
    () => [0, 0, 0],
  );
  const m = new Mesh(acc.build(false), armMaterial());
  m.castShadow = false;
  m.receiveShadow = false;
  m.frustumCulled = false;
  return m;
}
