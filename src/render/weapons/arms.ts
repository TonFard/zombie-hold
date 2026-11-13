import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { lerp } from '../../game/core/math';
import { Builder, toGroup, type Style } from '../kit';

/** 第一人称的双臂：袖子、卷起的前臂、战术手套（分节手指）、左腕手表；两段骨头的简易 IK */

const SLEEVE = 0x4e5544;
const SLEEVE_DARK = 0x3d4336;
const SKIN = 0xb88a6a;
const GLOVE = 0x1e1f1c;
const GLOVE_PAD = 0x2e302b;
const WATCH = 0x15171a;

const Z_AXIS = new Vector3(0, 0, 1);
/** 手心到手套根部（前臂接上去的地方）的距离 */
const WRIST = 0.06;

/** 默认的手指弯曲：第一节 / 第二节（弧度，curl = 1 时） */
const CURL_1 = 0.9;
const CURL_2 = 1.0;
/** 拇指默认姿势 */
const THUMB_RY = -0.6;
const THUMB_RX = 0.4;

const cloth = (color: number): Style => ({ color, jitter: 0.08, ao: 0.12, aoH: 0.4 });

const mesh = (b: Builder): Group => toGroup(b.build(), { castShadow: false, receiveShadow: false, smooth: true });

/** 一段手臂：沿 +Z 长度为 1 的圆柱（两端略收），用 scale.z 拉到需要的长度 */
function limb(r0: number, r1: number, color: number, cuff?: number): Group {
  const b = new Builder();
  b.tubeZ(r0, 1, 14, {}, cloth(color), r1);
  // 衣服褶皱：几道略粗的环
  for (const z of [0.3, 0.55]) b.tubeZ(lerp(r0, r1, z) * 1.04, 0.05, 14, { z }, cloth(SLEEVE_DARK));
  if (cuff !== undefined) b.tubeZ(r1 * 1.12, 0.14, 14, { z: 0.86 }, cloth(cuff));
  return mesh(b);
}

/** 一节手指：沿 +Z 的圆柱，可选指节护垫 */
function phalanx(r: number, len: number, pad: boolean): Group {
  const b = new Builder();
  b.tubeZ(r, len, 8, {}, cloth(GLOVE));
  if (pad) b.rbox(0.017, 0.006, 0.012, 0.002, { y: 0.006, z: 0.0 }, cloth(GLOVE_PAD));
  return mesh(b);
}

/**
 * 战术手套：手掌 + 四根两节的手指 + 两节拇指，手指 / 拇指是单独的节点，弯曲程度可以随时改（setGrip）。
 * 手套坐标：+Z = 手指方向，-Y = 掌心（手指往 -Y 弯），原点在手心
 */
class Glove {
  readonly root = new Group();
  /** 每根手指：[第一节的支点, 第二节的支点] */
  private readonly fingers: Array<[Object3D, Object3D]> = [];
  private readonly thumb1 = new Group();
  private readonly thumb2 = new Group();
  private readonly s: number;

  constructor(left: boolean) {
    const s = (this.s = left ? -1 : 1);
    const b = new Builder();
    const g = cloth(GLOVE);
    // 手掌
    b.rbox(0.078, 0.03, 0.09, 0.012, { y: -0.015, z: 0.0 }, g);
    b.rbox(0.064, 0.008, 0.05, 0.004, { y: 0.012, z: 0.005 }, cloth(GLOVE_PAD));
    // 手腕
    b.tubeZ(0.036, 0.05, 12, { z: -0.07 }, g, 0.038);
    // 左手腕上戴着表
    if (left) {
      b.tubeZ(0.04, 0.018, 16, { z: -0.06 }, { color: WATCH, mat: 'metal', jitter: 0.04, ao: 0 });
      b.cyl(0.016, 0.016, 0.006, 16, { y: 0.038, z: -0.051 }, { color: 0x222628, mat: 'metal', jitter: 0, ao: 0 });
      b.cyl(0.012, 0.012, 0.001, 16, { y: 0.0445, z: -0.051 }, { color: 0x4aff9a, mat: 'glow', glow: 0.8 });
    }
    this.root.add(mesh(b));
    for (let i = 0; i < 4; i++) {
      const len = i === 0 || i === 3 ? 0.03 : 0.034;
      const p1 = new Group();
      p1.position.set((i - 1.5) * 0.019 * s, -0.006, 0.045);
      p1.add(phalanx(0.0085, len, true));
      const p2 = new Group();
      p2.position.z = len;
      p2.add(phalanx(0.008, len * 0.85, false));
      p1.add(p2);
      this.root.add(p1);
      this.fingers.push([p1, p2]);
    }
    // 拇指：从手掌侧面绕过来
    this.thumb1.position.set(0.036 * s, -0.02, -0.01);
    this.thumb1.rotation.order = 'YXZ';
    this.thumb1.add(phalanx(0.0095, 0.04, false));
    this.thumb2.position.z = 0.04;
    this.thumb2.rotation.y = -0.5 * s;
    this.thumb2.add(phalanx(0.009, 0.03, false));
    this.thumb1.add(this.thumb2);
    this.root.add(this.thumb1);
    this.setGrip(1, 0);
  }

  private curl = NaN;
  private thumbDeg = NaN;

  /** curl：手指弯曲（1 = 默认握把，0 = 伸直）；thumb：拇指往外张开的角度（度） */
  setGrip(curl: number, thumb: number): void {
    if (curl === this.curl && thumb === this.thumbDeg) return;
    this.curl = curl;
    this.thumbDeg = thumb;
    for (const [p1, p2] of this.fingers) {
      p1.rotation.x = CURL_1 * curl;
      p2.rotation.x = CURL_2 * curl;
    }
    this.thumb1.rotation.set(THUMB_RX, (THUMB_RY - (thumb * Math.PI) / 180) * this.s, 0);
  }
}

/** 前臂露出一段皮肤（袖子卷起来） */
function forearm(): Group {
  const b = new Builder();
  b.tubeZ(0.04, 0.55, 14, {}, cloth(SLEEVE), 0.038);
  b.tubeZ(0.045, 0.12, 14, { z: 0.5 }, cloth(SLEEVE_DARK), 0.044); // 卷起的袖口
  b.tubeZ(0.034, 0.38, 14, { z: 0.62 }, { color: SKIN, jitter: 0.05, ao: 0 }, 0.031);
  return mesh(b);
}

export class Arm {
  readonly upper = limb(0.055, 0.047, SLEEVE);
  readonly fore = forearm();
  private readonly glove: Glove;
  readonly hand: Group;
  readonly root = new Group();
  readonly elbow = new Vector3();

  constructor(left: boolean) {
    this.glove = new Glove(left);
    this.hand = this.glove.root;
    this.root.add(this.upper, this.fore, this.hand);
  }

  /** 手指弯曲和拇指张开（见 Glove.setGrip） */
  setGrip(curl: number, thumb: number): void {
    this.glove.setGrip(curl, thumb);
  }

  private readonly d = new Vector3();
  private readonly n = new Vector3();
  private readonly w = new Vector3();
  private readonly bx = new Vector3();
  private readonly by = new Vector3();
  private readonly bz = new Vector3();
  private readonly bm = new Matrix4();

  /**
   * 两段骨头的简易 IK：肩膀固定在 s，手在 t，肘部朝 pole 方向弯。
   * fwd / palm（TACZ 枪用）：手套直接用枪包里手臂方块的朝向——fwd = 手指方向，palm = 掌心朝哪边；
   * extra = 在这个朝向上再叠加的旋转（手部调节面板的旋转参数）。
   * 这时前臂接到手腕（手套根部），手套不再跟着前臂方向随便转。
   * minLen：每段骨头的最短长度（程序枪 0.34；TACZ 传 0，弯曲程度只看距离）
   */
  solve(s: Vector3, t: Vector3, pole: Vector3, fwd?: Vector3, palm?: Vector3, minLen = 0.34, extra?: Quaternion): void {
    this.hand.position.copy(t);
    let target = t;
    if (fwd && palm) {
      // 手套的 +Z = 手指，-Y = 掌心（手指往 -Y 弯），X = Y × Z
      const z = this.bz.copy(fwd).normalize();
      const y = this.by.copy(palm).negate().addScaledVector(z, palm.dot(z));
      if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(z, -z.y);
      y.normalize();
      const x = this.bx.crossVectors(y, z);
      this.hand.quaternion.setFromRotationMatrix(this.bm.makeBasis(x, y, z));
      if (extra) this.hand.quaternion.multiply(extra);
      // 手腕 = 手套根部：沿手套自己的 -Z 往回
      target = this.w.set(0, 0, -WRIST).applyQuaternion(this.hand.quaternion).add(t);
    }
    const d = this.d.subVectors(target, s);
    const full = Math.max(0.05, d.length());
    // 手臂长度跟着距离走，总是留一点弯曲，这样不同的枪都够得着
    const l = Math.max(minLen, full / 1.85);
    const dist = Math.min(full, l * 2 - 0.002);
    d.multiplyScalar(1 / full);
    const a = dist / 2;
    const h = Math.sqrt(Math.max(0, l * l - a * a));
    const n = this.n.copy(pole).addScaledVector(d, -pole.dot(d));
    if (n.lengthSq() < 1e-6) n.set(0, -1, 0);
    n.normalize();
    this.elbow.copy(s).addScaledVector(d, a).addScaledVector(n, h);
    this.place(this.upper, s, this.elbow);
    // 前臂终点停在手腕（手套根部），手套本身放在握点上
    const wrist = this.d.subVectors(target, this.elbow);
    const wl = wrist.length() || 1;
    wrist.multiplyScalar(1 / wl);
    this.fore.position.copy(this.elbow);
    this.fore.quaternion.setFromUnitVectors(Z_AXIS, wrist);
    this.fore.scale.set(1, 1, fwd ? Math.max(0.05, wl) : Math.max(0.05, wl - 0.07));
    if (!(fwd && palm)) this.hand.quaternion.setFromUnitVectors(Z_AXIS, wrist);
  }

  private place(obj: Object3D, a: Vector3, b: Vector3): void {
    const d = this.d.subVectors(b, a);
    const len = Math.max(0.01, d.length());
    obj.position.copy(a);
    obj.quaternion.setFromUnitVectors(Z_AXIS, d.multiplyScalar(1 / len));
    obj.scale.set(1, 1, len);
  }
}
