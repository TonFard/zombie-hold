import { Group, Object3D, Vector3 } from 'three';
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

const cloth = (color: number): Style => ({ color, jitter: 0.08, ao: 0.12, aoH: 0.4 });

/** 一段手臂：沿 +Z 长度为 1 的圆柱（两端略收），用 scale.z 拉到需要的长度 */
function limb(r0: number, r1: number, color: number, cuff?: number): Group {
  const b = new Builder();
  b.tubeZ(r0, 1, 14, {}, cloth(color), r1);
  // 衣服褶皱：几道略粗的环
  for (const z of [0.3, 0.55]) b.tubeZ(lerp(r0, r1, z) * 1.04, 0.05, 14, { z }, cloth(SLEEVE_DARK));
  if (cuff !== undefined) b.tubeZ(r1 * 1.12, 0.14, 14, { z: 0.86 }, cloth(cuff));
  return toGroup(b.build(), { castShadow: false, receiveShadow: false, smooth: true });
}

/** 战术手套：手背护垫、指节、四根弯曲的手指、拇指 */
function glove(left: boolean): Group {
  const b = new Builder();
  const g = cloth(GLOVE);
  const pad = cloth(GLOVE_PAD);
  const s = left ? -1 : 1;
  // 手掌
  b.rbox(0.078, 0.03, 0.09, 0.012, { y: -0.015, z: 0.0 }, g);
  b.rbox(0.064, 0.008, 0.05, 0.004, { y: 0.012, z: 0.005 }, pad);
  // 手腕
  b.tubeZ(0.036, 0.05, 12, { z: -0.07 }, g, 0.038);
  // 四根手指：每根两节，向掌心（-Y）弯曲握住枪
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.019 * s;
    const len = i === 0 || i === 3 ? 0.03 : 0.034;
    b.push({ x, y: -0.006, z: 0.045, rx: 0.9 });
    b.tubeZ(0.0085, len, 8, {}, g);
    b.rbox(0.017, 0.006, 0.012, 0.002, { y: 0.006, z: 0.0 }, pad); // 指节护垫
    b.push({ z: len, rx: 1.0 });
    b.tubeZ(0.008, len * 0.85, 8, {}, g);
    b.pop();
    b.pop();
  }
  // 拇指：从手掌侧面绕过来
  b.push({ x: 0.036 * s, y: -0.02, z: -0.01, ry: -0.6 * s, rx: 0.4 });
  b.tubeZ(0.0095, 0.04, 8, {}, g);
  b.push({ z: 0.04, ry: -0.5 * s });
  b.tubeZ(0.009, 0.03, 8, {}, g);
  b.pop();
  b.pop();
  // 左手腕上戴着表
  if (left) {
    b.tubeZ(0.04, 0.018, 16, { z: -0.06 }, { color: WATCH, mat: 'metal', jitter: 0.04, ao: 0 });
    b.cyl(0.016, 0.016, 0.006, 16, { y: 0.038, z: -0.051 }, { color: 0x222628, mat: 'metal', jitter: 0, ao: 0 });
    b.cyl(0.012, 0.012, 0.001, 16, { y: 0.0445, z: -0.051 }, { color: 0x4aff9a, mat: 'glow', glow: 0.8 });
  }
  return toGroup(b.build(), { castShadow: false, receiveShadow: false, smooth: true });
}

/** 前臂露出一段皮肤（袖子卷起来） */
function forearm(): Group {
  const b = new Builder();
  b.tubeZ(0.04, 0.55, 14, {}, cloth(SLEEVE), 0.038);
  b.tubeZ(0.045, 0.12, 14, { z: 0.5 }, cloth(SLEEVE_DARK), 0.044); // 卷起的袖口
  b.tubeZ(0.034, 0.38, 14, { z: 0.62 }, { color: SKIN, jitter: 0.05, ao: 0 }, 0.031);
  return toGroup(b.build(), { castShadow: false, receiveShadow: false, smooth: true });
}

export class Arm {
  readonly upper = limb(0.055, 0.047, SLEEVE);
  readonly fore = forearm();
  readonly hand: Group;
  readonly root = new Group();
  readonly elbow = new Vector3();

  constructor(left: boolean) {
    this.hand = glove(left);
    this.root.add(this.upper, this.fore, this.hand);
  }

  private readonly d = new Vector3();
  private readonly n = new Vector3();

  /** 两段骨头的简易 IK：肩膀固定在 s，手在 t，肘部朝 pole 方向弯 */
  solve(s: Vector3, t: Vector3, pole: Vector3): void {
    const d = this.d.subVectors(t, s);
    const full = Math.max(0.05, d.length());
    // 手臂长度跟着距离走，总是留一点弯曲，这样不同的枪都够得着
    const l = Math.max(0.34, full / 1.85);
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
    const wrist = this.d.subVectors(t, this.elbow);
    const wl = wrist.length() || 1;
    wrist.multiplyScalar(1 / wl);
    this.fore.position.copy(this.elbow);
    this.fore.quaternion.setFromUnitVectors(Z_AXIS, wrist);
    this.fore.scale.set(1, 1, Math.max(0.05, wl - 0.07));
    this.hand.position.copy(t);
    this.hand.quaternion.setFromUnitVectors(Z_AXIS, wrist);
  }

  private place(obj: Object3D, a: Vector3, b: Vector3): void {
    const d = this.d.subVectors(b, a);
    const len = Math.max(0.01, d.length());
    obj.position.copy(a);
    obj.quaternion.setFromUnitVectors(Z_AXIS, d.multiplyScalar(1 / len));
    obj.scale.set(1, 1, len);
  }
}

