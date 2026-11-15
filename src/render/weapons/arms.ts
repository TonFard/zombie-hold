import { Group, Matrix4, type Bone, type Object3D, type Quaternion, Vector3 } from 'three';
import { Builder, toGroup } from '../kit';
import { buildArm, FORE_BIND, upperSleeve, WRIST, type ArmRig } from './hand-mesh';

export { PALM_L, PALM_T, WRIST } from './hand-mesh';

/**
 * 第一人称的双臂：长袖、战术手套（分节手指）、左腕手表。网格和骨头在 hand-mesh.ts（一整张蒙皮网格），
 * 这里只管把肩、肘、手腕摆到位。
 * 尺寸按真人（米）做：TACZ 的枪模 1 像素 ≈ 2.1 厘米，和真枪一样大，手也得是真人大小才包得住护木
 */

const WATCH = 0x15171a;
const Z_AXIS = new Vector3(0, 0, 1);

/** 左手腕上的表：表带套在手套的束带外面，表盘在手背那侧。原点在手腕截面的中心，+Z = 手指方向 */
function watch(): Group {
  const b = new Builder();
  b.tubeZ(0.0356, 0.022, 18, { z: -0.011, sy: 0.79 }, { color: WATCH, mat: 'metal', jitter: 0.04, ao: 0 });
  b.cyl(0.0155, 0.0155, 0.006, 16, { y: 0.0272 }, { color: 0x222628, mat: 'metal', jitter: 0, ao: 0 });
  b.cyl(0.0118, 0.0118, 0.001, 16, { y: 0.0335 }, { color: 0x4aff9a, mat: 'glow', glow: 0.8 });
  return toGroup(b.build(), { castShadow: false, receiveShadow: false, smooth: true });
}
/** 表在手套坐标里的 z（手腕束带的中间） */
const WATCH_Z = -0.066;

export class Arm {
  readonly root = new Group();
  /** 上臂：沿 +Z 长度为 1 的袖子，用 scale.z 从肩拉到肘 */
  readonly upper = upperSleeve();
  readonly rig: ArmRig;
  /** 前臂（骨头）：原点在肘，+Z 指向手腕；scale.z = 实际长度 / 绑定长度 */
  readonly fore: Bone;
  /** 手（骨头）：手套坐标，原点在手心 */
  readonly hand: Bone;
  readonly elbow = new Vector3();

  constructor(left: boolean) {
    this.rig = buildArm(left);
    this.fore = this.rig.fore;
    this.hand = this.rig.hand;
    if (left) {
      const w = watch();
      w.position.z = WATCH_Z + WRIST + FORE_BIND;
      this.fore.add(w);
    }
    this.root.add(this.upper, this.fore, this.hand, this.rig.mesh);
  }

  /**
   * 手指和拇指的姿势。curl：手指弯曲（1 = 握住握把的程度，0 = 伸直）；thumb：拇指往外张开的角度（度，0 = 搭在食指上）；
   * tip：后两节相对第一节的弯曲倍数（握方的护木时第一节弯得多、后两节弯得少）；index：食指相对其它手指的弯曲倍数
   * （扣扳机的食指比握着握把的三根手指直）；thumbUp：拇指往掌心那边压多少度（托护木时拇指贴着枪的侧面往上）
   */
  setGrip(curl: number, thumb: number, tip = 1, index = 1, thumbUp = 0): void {
    this.rig.setGrip(curl, thumb, tip, index, thumbUp);
  }

  private readonly d = new Vector3();
  private readonly n = new Vector3();
  private readonly w = new Vector3();
  private readonly bx = new Vector3();
  private readonly by = new Vector3();
  private readonly bz = new Vector3();
  private readonly bm = new Matrix4();

  /**
   * 两段骨头的简易 IK（程序枪用）：肩膀固定在 s，手在 t，肘部朝 pole 方向弯。
   * minLen：每段骨头的最短长度
   */
  solve(s: Vector3, t: Vector3, pole: Vector3, minLen = 0.34): void {
    this.hand.position.copy(t);
    const d = this.d.subVectors(t, s);
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
    const wrist = this.d.subVectors(t, this.elbow);
    const wl = wrist.length() || 1;
    wrist.multiplyScalar(1 / wl);
    this.fore.position.copy(this.elbow);
    this.fore.quaternion.setFromUnitVectors(Z_AXIS, wrist);
    this.fore.scale.z = Math.max(0.05, wl - WRIST) / FORE_BIND;
    this.hand.quaternion.copy(this.fore.quaternion);
  }

  private readonly back = new Vector3();
  private readonly axis = new Vector3();
  private readonly ik = new Vector3();

  /**
   * TACZ 枪：手套朝向 = 枪包里手臂方块的朝向（fwd = 方块指向手掌端，palm = 方块贴着枪的那面）× extra
   * （手部摆放参数里的旋转），握点 t 再按手套自己的坐标挪 local（转完之后的 X / Y / Z，跟着动画一起转）。
   *
   * 手臂按真人的样子接：肩膀 s 固定在镜头下方（视角相机空间），上臂 upperLen、前臂 foreLen，两段骨头 IK 求出肘
   * （往 pole 那边弯）；手腕（手套根部）相对手背方向最多弯 maxBend 弧度，超了就把前臂往手背方向扳回来——
   * 手是按握把 / 护木摆好的，不能让前臂从奇怪的方向戳过来把手腕折成直角。上臂从肩膀拉到肘（够不着时会被拉长，
   * 那一段都在画面外）
   */
  solveTacz(s: Vector3, t: Vector3, fwd: Vector3, palm: Vector3, extra: Quaternion, local: Vector3, upperLen: number, foreLen: number, maxBend: number, pole: Vector3): void {
    // 手套的 +Z = 手指，-Y = 掌心（手指往 -Y 弯），X = Y × Z
    const z = this.bz.copy(fwd).normalize();
    const y = this.by.copy(palm).negate().addScaledVector(z, palm.dot(z));
    if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(z, -z.y);
    y.normalize();
    const x = this.bx.crossVectors(y, z);
    const q = this.hand.quaternion.setFromRotationMatrix(this.bm.makeBasis(x, y, z)).multiply(extra);
    this.hand.position.copy(local).applyQuaternion(q).add(t);
    const wrist = this.w.set(0, 0, -WRIST).applyQuaternion(q).add(this.hand.position);
    // 两段骨头 IK：肘在「肩 → 手腕」连线旁边、朝 pole 那侧
    const d = this.d.subVectors(wrist, s);
    const dist = Math.max(1e-4, d.length());
    d.multiplyScalar(1 / dist);
    const ik = this.ik;
    if (dist >= upperLen + foreLen) ik.copy(wrist).addScaledVector(d, -foreLen);
    else {
      const a = Math.max(-upperLen, Math.min(upperLen, (upperLen * upperLen - foreLen * foreLen + dist * dist) / (2 * dist)));
      const h = Math.sqrt(Math.max(0, upperLen * upperLen - a * a));
      const n = this.n.copy(pole).addScaledVector(d, -pole.dot(d));
      if (n.lengthSq() < 1e-8) n.set(0, -1, 0).addScaledVector(d, d.y);
      n.normalize();
      ik.copy(s).addScaledVector(d, a).addScaledVector(n, h);
    }
    // 前臂方向（手腕 → 肘）：朝 IK 的肘，但相对手背方向最多弯 maxBend
    const want = ik.sub(wrist).normalize();
    const back = this.back.set(0, 0, -1).applyQuaternion(q);
    const ang = back.angleTo(want);
    if (ang > maxBend) {
      const axis = this.axis.crossVectors(back, want);
      if (axis.lengthSq() > 1e-10) back.applyAxisAngle(axis.normalize(), maxBend);
    } else back.copy(want);
    this.elbow.copy(wrist).addScaledVector(back, foreLen);
    this.place(this.upper, s, this.elbow);
    // 前臂的骨头：+Z = 肘 → 手腕；绕自己轴线的转角跟着手背走（袖口、手套口不会拧成麻花）
    const fz = this.bz.copy(back).negate();
    const fy = this.by.set(0, 1, 0).applyQuaternion(q);
    fy.addScaledVector(fz, -fy.dot(fz));
    if (fy.lengthSq() < 1e-8) fy.set(1, 0, 0).applyQuaternion(q).cross(fz).negate();
    fy.normalize();
    const fx = this.bx.crossVectors(fy, fz);
    this.fore.position.copy(this.elbow);
    this.fore.quaternion.setFromRotationMatrix(this.bm.makeBasis(fx, fy, fz));
    this.fore.scale.z = foreLen / FORE_BIND;
  }

  private place(obj: Object3D, a: Vector3, b: Vector3): void {
    const d = this.d.subVectors(b, a);
    const len = Math.max(0.01, d.length());
    obj.position.copy(a);
    obj.quaternion.setFromUnitVectors(Z_AXIS, d.multiplyScalar(1 / len));
    obj.scale.set(1, 1, len);
  }
}
