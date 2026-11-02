import { Group, Object3D, Vector3 } from 'three';
import type { WeaponKind } from '../../game/data/weapons';
import { poseSurvivor } from '../anim/poses';
import { B, HUMAN, RigActor, makeJoints, type Joints } from '../anim/rig';
import { Builder, Mats, type Built, type Style } from '../kit';
import { buildWeapon, type WeaponModel } from './weapons';

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.12, ao: 0.3, aoH: 1.2, ...o });
const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', jitter: 0.14, ao: 0.2, aoH: 1.2, ...o });
const glow = (color: number, k = 2): Style => ({ color, mat: 'glow', glow: k });

const SKIN = 0xc79d7d;
const SKIN_D = 0xa87f62;
const VEST = 0x2e3328;
const POUCH = 0x3d4434;
const CARGO = 0x4d4c3c;
const SHIRT = 0x5a5f4a;

function limb(b: Builder, x: number, yTop: number, yBot: number, w: number, d: number, st: Style, z = 0): void {
  b.rbox(w, yTop - yBot, d, Math.min(w, d) * 0.3, { x, y: yBot, z }, st);
}

const J: Joints = makeJoints(HUMAN);

function buildGeometry(): Built {
  const b = new Builder(true);
  const waist = J.chest[1];
  const neck = J.head[1];
  const topY = neck - 0.03;
  const tw = 0.37;
  const td = 0.22;

  // ---- 骨盆：腰带、裤子 ----
  b.bone(B.pelvis);
  b.rbox(0.31, 0.22, 0.21, 0.05, { y: J.pelvis[1] - 0.14 }, matte(CARGO));
  b.box(0.32, 0.05, 0.22, { y: J.pelvis[1] + 0.0 }, matte(0x1a1a16, { jitter: 0.1, ao: 0 }));
  b.box(0.06, 0.04, 0.01, { y: J.pelvis[1] + 0.0, z: 0.112 }, metal(0xb0b0a0, { ao: 0 }));
  // 腰包 + 枪套
  b.rbox(0.09, 0.11, 0.07, 0.015, { x: 0.19, y: J.pelvis[1] - 0.16, z: 0.02 }, matte(POUCH));
  b.rbox(0.05, 0.16, 0.06, 0.012, { x: -0.18, y: J.pelvis[1] - 0.2, z: 0.0 }, matte(0x1c1c1c));

  // ---- 躯干：衬衣 + 战术背心 ----
  b.bone(B.chest);
  b.rbox(tw, topY - waist, td, 0.06, { y: waist }, matte(SHIRT));
  b.rbox(tw * 1.06, topY - waist - 0.08, td * 1.1, 0.05, { y: waist + 0.02 }, matte(VEST, { jitter: 0.1 }));
  // 肩带
  for (const s of [-1, 1]) b.box(0.06, 0.1, td * 1.12, { x: s * 0.12, y: topY - 0.1 }, matte(VEST));
  // 弹匣袋（三个）、无线电
  for (let i = -1; i <= 1; i++) {
    b.rbox(0.085, 0.13, 0.05, 0.012, { x: i * 0.105, y: waist + 0.06, z: td / 2 + 0.03 }, matte(POUCH, { jitter: 0.15 }));
    b.box(0.07, 0.02, 0.052, { x: i * 0.105, y: waist + 0.17, z: td / 2 + 0.03 }, matte(0x24291e, { jitter: 0.1, ao: 0 }));
    b.box(0.012, 0.045, 0.012, { x: i * 0.105, y: waist + 0.11, z: td / 2 + 0.06 }, metal(0x9a9a8a, { ao: 0 }));
  }
  b.rbox(0.06, 0.1, 0.04, 0.01, { x: -0.13, y: waist + 0.26, z: td / 2 + 0.025 }, matte(0x1e2018)); // 无线电
  b.rod([-0.13, waist + 0.36, td / 2 + 0.03], [-0.15, waist + 0.5, td / 2 + 0.03], 0.004, metal(0x1c1c1c, { ao: 0 }), 4); // 天线
  b.box(0.012, 0.012, 0.012, { x: -0.11, y: waist + 0.3, z: td / 2 + 0.05 }, glow(0x44ff77, 1.8)); // 指示灯
  // 背包 + 卷铺
  b.rbox(0.34, 0.42, 0.18, 0.04, { y: waist + 0.02, z: -td / 2 - 0.1 }, matte(0x4a4a38, { jitter: 0.16 }));
  b.rbox(0.28, 0.16, 0.06, 0.02, { y: waist + 0.1, z: -td / 2 - 0.22 }, matte(0x3d3d2e));
  // 背包顶上的铺盖卷：横放，和背包等宽
  b.cyl(0.06, 0.06, 0.34, 10, { y: waist + 0.46, z: -td / 2 - 0.1, rz: Math.PI / 2, x: 0.17 }, matte(0x55503a, { jitter: 0.2 }));
  b.box(0.04, 0.12, 0.13, { y: waist + 0.4, z: -td / 2 - 0.1, x: 0.0 }, matte(0x2a2a20, { jitter: 0.1, ao: 0 }));
  b.box(0.04, 0.3, 0.012, { x: 0.1, y: waist + 0.1, z: -td / 2 - 0.01 }, matte(0x2a2a20));
  b.box(0.04, 0.3, 0.012, { x: -0.1, y: waist + 0.1, z: -td / 2 - 0.01 }, matte(0x2a2a20));

  // ---- 头：头盔、头灯、护目镜 ----
  b.bone(B.head);
  const hy = neck;
  b.cyl(0.05, 0.06, 0.1, 6, { y: hy - 0.06 }, matte(SKIN_D));
  b.rbox(0.19, 0.24, 0.21, 0.06, { y: hy + 0.03, z: 0.01 }, matte(SKIN, { jitter: 0.1 }));
  b.rbox(0.15, 0.07, 0.17, 0.03, { y: hy - 0.005, z: 0.03 }, matte(SKIN_D));
  b.box(0.1, 0.02, 0.012, { y: hy + 0.08, z: 0.118 }, matte(0x6a3a30, { jitter: 0, ao: 0 })); // 嘴
  b.box(0.035, 0.05, 0.03, { y: hy + 0.115, z: 0.12 }, matte(SKIN));
  for (const s of [-1, 1]) {
    b.box(0.03, 0.018, 0.012, { x: s * 0.048, y: hy + 0.17, z: 0.112 }, matte(0x14120e, { jitter: 0, ao: 0 }));
    b.box(0.02, 0.05, 0.04, { x: s * 0.105, y: hy + 0.12, z: 0.0 }, matte(SKIN_D));
  }
  // 头盔：半球 + 帽檐
  b.sphere(0.135, 12, 8, { y: hy + 0.22, z: 0.0, sy: 0.78 }, metal(0x4a5240, { jitter: 0.18, ao: 0.1, aoH: 2 }));
  b.cyl(0.14, 0.15, 0.05, 12, { y: hy + 0.2 }, metal(0x3d4434, { jitter: 0.15, ao: 0 }));
  b.box(0.08, 0.04, 0.01, { y: hy + 0.3, z: 0.125 }, matte(0x2a2e22, { ao: 0 }));
  // 头灯
  b.rbox(0.06, 0.04, 0.04, 0.01, { y: hy + 0.24, z: 0.14 }, metal(0x1c1e1a, { ao: 0 }));
  b.box(0.04, 0.025, 0.006, { y: hy + 0.245, z: 0.162 }, glow(0xfff3d0, 3.2));
  // 护目镜推在头盔上
  b.rbox(0.17, 0.04, 0.03, 0.01, { y: hy + 0.255, z: 0.11 }, matte(0x1a1a1a));
  b.box(0.15, 0.03, 0.01, { y: hy + 0.26, z: 0.128 }, metal(0x2a4a5a, { ao: 0 }));
  // 脖巾
  b.rbox(0.17, 0.07, 0.18, 0.025, { y: hy - 0.1, z: 0.01 }, matte(0x7a3a2a, { jitter: 0.15 }));

  // ---- 手臂 ----
  for (const side of [0, 1] as const) {
    const sh = side === 0 ? J.shoulderL : J.shoulderR;
    const el = side === 0 ? J.elbowL : J.elbowR;
    const wr = side === 0 ? J.wristL : J.wristR;
    const cx = (sh[0] + el[0]) / 2;
    b.bone(side === 0 ? B.armUL : B.armUR);
    b.sphere(0.058, 7, 5, { x: sh[0], y: sh[1] - 0.02 }, matte(SHIRT));
    limb(b, cx, sh[1] - 0.02, el[1], 0.095, 0.095, matte(SHIRT));
    b.box(0.1, 0.03, 0.1, { x: cx, y: el[1] + 0.02 }, matte(0x2a2c22, { jitter: 0.1, ao: 0 })); // 卷起的袖口
    b.bone(side === 0 ? B.armLL : B.armLR);
    b.sphere(0.052, 6, 4, { x: el[0], y: el[1] }, matte(0x2e3028)); // 护肘
    limb(b, (el[0] + wr[0]) / 2, el[1], wr[1] + 0.05, 0.08, 0.078, matte(SKIN));
    b.rbox(0.09, 0.05, 0.09, 0.01, { x: wr[0], y: wr[1] - 0.0 }, matte(0x1a1a18)); // 护腕
    // 战术手套
    b.rbox(0.085, 0.1, 0.05, 0.015, { x: wr[0], y: wr[1] - 0.1, z: 0.0 }, matte(0x1c1c1a));
    for (let f = -1; f <= 1; f++) b.rbox(0.018, 0.06, 0.018, 0.006, { x: wr[0] + f * 0.026, y: wr[1] - 0.16, z: 0.012 }, matte(0x1c1c1a));
  }

  // ---- 腿：工装裤、护膝、靴子 ----
  for (const side of [0, 1] as const) {
    const hp = side === 0 ? J.hipL : J.hipR;
    const kn = side === 0 ? J.kneeL : J.kneeR;
    const an = side === 0 ? J.ankleL : J.ankleR;
    b.bone(side === 0 ? B.legUL : B.legUR);
    b.sphere(0.075, 7, 5, { x: hp[0], y: hp[1] }, matte(CARGO));
    limb(b, hp[0], hp[1], kn[1], 0.13, 0.14, matte(CARGO));
    b.rbox(0.05, 0.12, 0.06, 0.012, { x: hp[0] + (side === 0 ? 0.075 : -0.075), y: kn[1] + 0.2, z: 0.02 }, matte(POUCH)); // 大腿口袋
    b.bone(side === 0 ? B.legLL : B.legLR);
    b.sphere(0.065, 6, 4, { x: kn[0], y: kn[1] }, matte(CARGO));
    limb(b, kn[0], kn[1], an[1] + 0.1, 0.108, 0.115, matte(CARGO));
    b.rbox(0.1, 0.12, 0.05, 0.02, { x: kn[0], y: kn[1] - 0.06, z: 0.065 }, matte(0x1c1c1a, { jitter: 0.1 })); // 护膝
    // 靴子 + 绑腿
    b.rbox(0.115, 0.14, 0.13, 0.025, { x: kn[0], y: 0.06, z: 0.0 }, matte(0x2a2420, { jitter: 0.15 }));
    b.rbox(0.115, 0.08, 0.28, 0.03, { x: kn[0], y: 0.0, z: 0.07 }, matte(0x24201c, { jitter: 0.15 }));
    b.box(0.118, 0.025, 0.285, { x: kn[0], y: 0.0, z: 0.07 }, matte(0x0e0e0c, { jitter: 0, ao: 0 }));
    for (let i = 0; i < 3; i++) b.box(0.07, 0.008, 0.01, { x: kn[0], y: 0.1 + i * 0.03, z: 0.068 }, matte(0x8a8a7a, { jitter: 0, ao: 0 }));
  }
  return b.build();
}

let cached: Built | null = null;

export interface PlayerRenderState {
  yaw: number;
  vx: number;
  vz: number;
  phase: number;
  sprinting: boolean;
  recoil: number;
}

/** 玩家：骨架 + 当前持有的武器 + 双手 IK */
export class PlayerActor {
  readonly rig: RigActor;
  readonly group = new Group();
  private readonly mount = new Object3D();
  private weapon: WeaponModel | null = null;
  private weaponKey = '';
  private readonly tmpR = new Vector3();
  private readonly tmpL = new Vector3();
  private readonly hintR = new Vector3(-0.6, -1, -0.25);
  private readonly hintL = new Vector3(0.6, -1, -0.25);

  constructor() {
    cached ??= buildGeometry();
    this.rig = new RigActor(cached, Mats, J, Mats.flash);
    this.group.add(this.rig.group);
    this.rig.bone(B.chest).add(this.mount);
    this.mount.position.set(0.0, 0.3, 0.2);
  }

  get currentWeapon(): WeaponModel | null {
    return this.weapon;
  }

  setWeapon(kind: WeaponKind, tier: number): void {
    const key = `${kind}:${tier}`;
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    if (this.weapon) {
      this.mount.remove(this.weapon.group);
      this.weapon.group.traverse((o) => {
        const m = o as { geometry?: { dispose(): void } };
        m.geometry?.dispose();
      });
    }
    this.weapon = buildWeapon(kind, tier);
    this.mount.add(this.weapon.group);
  }

  /** 世界空间的枪口位置（射击特效用） */
  muzzleWorld(out: Vector3): Vector3 {
    if (!this.weapon) return out.set(0, 1.3, 0);
    this.rig.group.updateMatrixWorld(true);
    return this.weapon.group.localToWorld(out.copy(this.weapon.muzzle));
  }

  update(t: number, s: PlayerRenderState): void {
    this.group.rotation.y = s.yaw;
    const speed = Math.hypot(s.vx, s.vz);
    // 移动方向与朝向的夹角，决定是否倒退
    const fwd = speed > 0.05 ? s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw) : 1;
    poseSurvivor(this.rig, { t, phase: s.phase, speed, backward: fwd < -0.1 * speed, sprinting: s.sprinting, recoil: s.recoil });
    if (!this.weapon) return;
    // 后坐力：枪向后顶并微微上扬
    this.mount.position.set(0.0, 0.3 + s.recoil * 0.012, 0.2 - s.recoil * 0.05);
    const w = this.weapon;
    this.tmpR.copy(w.gripR).add(this.mount.position);
    this.tmpL.copy(w.gripL).add(this.mount.position);
    this.rig.solveArm(1, this.tmpR, this.hintR);
    this.rig.solveArm(0, this.tmpL, this.hintL);
  }
}
