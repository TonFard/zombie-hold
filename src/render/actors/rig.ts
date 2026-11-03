import { Bone, Group, Quaternion, Skeleton, SkinnedMesh, Vector3, type Material } from 'three';
import type { Built } from '../kit';

/** 人形骨架：14 根骨头。模型朝 +Z，"左"为 +X。静止姿势四肢垂直向下。 */
export const B = {
  root: 0,
  pelvis: 1,
  chest: 2,
  head: 3,
  armUL: 4,
  armLL: 5,
  armUR: 6,
  armLR: 7,
  legUL: 8,
  legLL: 9,
  legUR: 10,
  legLR: 11,
  propL: 12,
  propR: 13,
} as const;
export const BONE_COUNT = 14;

export type V3 = [number, number, number];

/** 各关节在静止姿势下的模型空间位置 */
export interface Joints {
  pelvis: V3;
  chest: V3;
  head: V3;
  shoulderL: V3;
  shoulderR: V3;
  elbowL: V3;
  elbowR: V3;
  wristL: V3;
  wristR: V3;
  hipL: V3;
  hipR: V3;
  kneeL: V3;
  kneeR: V3;
  ankleL: V3;
  ankleR: V3;
}

export interface Proportions {
  hipY: number;
  waistY: number;
  neckY: number;
  shoulderY: number;
  shoulderX: number;
  hipX: number;
  kneeY: number;
  ankleY: number;
  upper: number;
  fore: number;
}

export const HUMAN: Proportions = {
  hipY: 0.95,
  waistY: 1.02,
  neckY: 1.5,
  shoulderY: 1.42,
  shoulderX: 0.23,
  hipX: 0.1,
  kneeY: 0.5,
  ankleY: 0.08,
  upper: 0.3,
  fore: 0.27,
};

export function makeJoints(p: Proportions): Joints {
  const elbowY = p.shoulderY - p.upper;
  const wristY = elbowY - p.fore;
  return {
    pelvis: [0, p.hipY, 0],
    chest: [0, p.waistY, 0],
    head: [0, p.neckY, 0],
    shoulderL: [p.shoulderX, p.shoulderY, 0],
    shoulderR: [-p.shoulderX, p.shoulderY, 0],
    elbowL: [p.shoulderX + 0.02, elbowY, 0],
    elbowR: [-p.shoulderX - 0.02, elbowY, 0],
    wristL: [p.shoulderX + 0.03, wristY, 0],
    wristR: [-p.shoulderX - 0.03, wristY, 0],
    hipL: [p.hipX, p.hipY - 0.02, 0],
    hipR: [-p.hipX, p.hipY - 0.02, 0],
    kneeL: [p.hipX, p.kneeY, 0.01],
    kneeR: [-p.hipX, p.kneeY, 0.01],
    ankleL: [p.hipX, p.ankleY, 0],
    ankleR: [-p.hipX, p.ankleY, 0],
  };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function createBones(J: Joints): Bone[] {
  const bones = Array.from({ length: BONE_COUNT }, (_, i) => {
    const b = new Bone();
    b.name = Object.keys(B)[i] as string;
    return b;
  });
  const at = (i: number) => bones[i] as Bone;
  const place = (i: number, parent: number, p: V3, pp: V3) => {
    const l = sub(p, pp);
    at(i).position.set(l[0], l[1], l[2]);
    at(parent).add(at(i));
  };
  at(B.root).position.set(0, 0, 0);
  place(B.pelvis, B.root, J.pelvis, [0, 0, 0]);
  place(B.chest, B.pelvis, J.chest, J.pelvis);
  place(B.head, B.chest, J.head, J.chest);
  place(B.armUL, B.chest, J.shoulderL, J.chest);
  place(B.armLL, B.armUL, J.elbowL, J.shoulderL);
  place(B.propL, B.armLL, J.wristL, J.elbowL);
  place(B.armUR, B.chest, J.shoulderR, J.chest);
  place(B.armLR, B.armUR, J.elbowR, J.shoulderR);
  place(B.propR, B.armLR, J.wristR, J.elbowR);
  place(B.legUL, B.pelvis, J.hipL, J.pelvis);
  place(B.legLL, B.legUL, J.kneeL, J.hipL);
  place(B.legUR, B.pelvis, J.hipR, J.pelvis);
  place(B.legLR, B.legUR, J.kneeR, J.hipR);
  return bones;
}

const DOWN = new Vector3(0, -1, 0);
const _s = new Vector3();
const _d = new Vector3();
const _e = new Vector3();
const _p = new Vector3();
const _u = new Vector3();
const _f = new Vector3();
const _q = new Quaternion();

/**
 * 一个带骨架的角色实例。几何体和材质在同类角色之间共享，骨架是各自独立的。
 */
export class RigActor {
  readonly group = new Group();
  readonly bones: Bone[];
  readonly skeleton: Skeleton;
  readonly meshes: SkinnedMesh[] = [];
  private readonly mats: Material[] = [];
  private flashing = false;

  /** 静止姿势下的肩 / 肘 / 腕，相对于 chest 骨（IK 用） */
  readonly shoulderLocal: [Vector3, Vector3];
  readonly upperLen: number;
  readonly foreLen: number;
  readonly pelvisBaseY: number;

  constructor(
    geoms: Built,
    mats: { matte: Material; metal: Material; glow: Material },
    readonly J: Joints,
    private readonly flashMat: Material,
  ) {
    this.bones = createBones(J);
    const root = this.bones[B.root] as Bone;
    root.updateMatrixWorld(true);
    this.skeleton = new Skeleton(this.bones);
    this.pelvisBaseY = (this.bones[B.pelvis] as Bone).position.y;

    // 骨骼根只有一个父节点（群组）；几个网格（哑光 / 金属 / 发光）共用同一个骨架
    this.group.add(root);
    for (const [geo, mat, cast] of [
      [geoms.matte, mats.matte, true],
      [geoms.metal, mats.metal, true],
      [geoms.glow, mats.glow, false],
    ] as const) {
      if (!geo) continue;
      const m = new SkinnedMesh(geo, mat);
      m.castShadow = cast;
      this.meshes.push(m);
      this.mats.push(mat);
      this.group.add(m);
    }
    this.group.updateMatrixWorld(true);
    for (const m of this.meshes) m.bind(this.skeleton, m.matrixWorld);

    this.shoulderLocal = [
      new Vector3(J.shoulderL[0] - J.chest[0], J.shoulderL[1] - J.chest[1], J.shoulderL[2] - J.chest[2]),
      new Vector3(J.shoulderR[0] - J.chest[0], J.shoulderR[1] - J.chest[1], J.shoulderR[2] - J.chest[2]),
    ];
    this.upperLen = Math.hypot(J.elbowL[0] - J.shoulderL[0], J.elbowL[1] - J.shoulderL[1], J.elbowL[2] - J.shoulderL[2]);
    this.foreLen = Math.hypot(J.wristL[0] - J.elbowL[0], J.wristL[1] - J.elbowL[1], J.wristL[2] - J.elbowL[2]);
  }

  bone(i: number): Bone {
    return this.bones[i] as Bone;
  }

  /** 受击闪白 */
  setFlash(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    for (let i = 0; i < this.meshes.length; i++) {
      const base = this.mats[i] as Material;
      // 自发光（眼睛、核心）不参与闪白
      (this.meshes[i] as SkinnedMesh).material = on && (base as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial ? this.flashMat : base;
    }
  }

  /**
   * 两段骨 IK：让手腕够到 chest 局部坐标系里的 target。
   * side 0 = 左（+X），1 = 右。hint 是肘部朝向的参考方向。
   */
  solveArm(side: 0 | 1, target: Vector3, hint: Vector3): void {
    const upper = this.bone(side === 0 ? B.armUL : B.armUR);
    const fore = this.bone(side === 0 ? B.armLL : B.armLR);
    const S = this.shoulderLocal[side];
    _d.copy(target).sub(S);
    const maxReach = (this.upperLen + this.foreLen) * 0.995;
    const dist = Math.min(maxReach, Math.max(0.08, _d.length()));
    _d.normalize();
    // 余弦定理求肘位
    const a = (dist * dist + this.upperLen * this.upperLen - this.foreLen * this.foreLen) / (2 * dist);
    const h = Math.sqrt(Math.max(0, this.upperLen * this.upperLen - a * a));
    _p.copy(hint).addScaledVector(_d, -hint.dot(_d));
    if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0).addScaledVector(_d, _d.y);
    _p.normalize();
    _e.copy(_d).multiplyScalar(a).addScaledVector(_p, h); // 肘相对肩
    _u.copy(_e).normalize();
    upper.quaternion.setFromUnitVectors(DOWN, _u);
    // 前臂方向（在 chest 空间）= 手腕 - 肘
    _s.copy(_d).multiplyScalar(dist);
    _f.copy(_s).sub(_e).normalize();
    _q.copy(upper.quaternion).invert();
    _f.applyQuaternion(_q);
    fore.quaternion.setFromUnitVectors(DOWN, _f);
  }

  /** 把所有骨头恢复到静止姿势 */
  resetPose(): void {
    for (let i = 1; i < this.bones.length; i++) {
      const b = this.bones[i] as Bone;
      b.rotation.set(0, 0, 0);
      b.quaternion.identity();
    }
    (this.bones[B.pelvis] as Bone).position.y = this.pelvisBaseY;
  }
}

