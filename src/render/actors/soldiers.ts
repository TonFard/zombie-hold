import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene, Vector3 } from 'three';
import { Rng } from '../../game/core/rng';
import type { Soldier } from '../../game/entities/soldier';
import type { Game } from '../../game/sim';
import { TDM } from '../../game/systems/tdm';
import { Builder, Mats, type Built, type Style } from '../kit';
import { B, HUMAN, RigActor, makeJoints, type Joints } from './rig';

/**
 * 团队死斗的士兵模型：同一套 14 骨人形骨架，战术服按队伍上色（蓝 / 红），头盔、防弹背心、手套，
 * 双手端着枪（右手握把、左手护木，IK）。走路、举枪、蹲下、受击、死亡倒地都在这里摆姿势。
 */

const matte = (color: number, o: Partial<Style> = {}): Style => ({ color, jitter: 0.12, ao: 0.3, aoH: 1.2, ...o });
const metal = (color: number, o: Partial<Style> = {}): Style => ({ color, mat: 'metal', jitter: 0.1, ao: 0.2, aoH: 1.2, ...o });
const glow = (color: number, k = 1.8): Style => ({ color, mat: 'glow', glow: k });

const TEAM = [
  { cloth: 0x3a4a5e, vest: 0x2a3644, band: 0x4aa8ff, helmet: 0x34404c },
  { cloth: 0x5e4436, vest: 0x40302a, band: 0xff5a3a, helmet: 0x4a3a30 },
] as const;
const SKINS = [0xd2a07a, 0xb8825e, 0x8a5a3e, 0xe0b490];

const J = makeJoints(HUMAN);
const cache = new Map<string, Built>();

function soldierGeometry(team: 0 | 1, variant: number, armed = true): Built {
  const key = `${team}:${variant}:${armed ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new Builder(true);
  const T = TEAM[team];
  const rng = new Rng(variant * 977 + team * 31);
  const skin = matte(SKINS[variant % SKINS.length] as number);
  const cloth = matte(T.cloth, { jitter: 0.18 });
  const vest = matte(T.vest, { jitter: 0.12 });
  const dark = matte(0x1a1c1e, { jitter: 0.08, ao: 0 });
  const band = glow(T.band, 1.6);
  const waist = J.chest[1];
  const neck = J.head[1];
  const topY = neck - 0.03;

  // 骨盆：裤子 + 腰带 + 腿包
  b.bone(B.pelvis);
  b.rbox(0.32, 0.22, 0.22, 0.05, { y: J.pelvis[1] - 0.14 }, cloth);
  b.box(0.33, 0.05, 0.23, { y: J.pelvis[1] + 0.02 }, dark);
  b.rbox(0.07, 0.1, 0.06, 0.015, { x: 0.15, y: J.pelvis[1] - 0.12, z: 0.06 }, vest);

  // 躯干：上衣 + 防弹背心（弹匣包、无线电）+ 队伍臂章
  b.bone(B.chest);
  b.rbox(0.36, topY - waist, 0.21, 0.06, { y: waist }, cloth);
  b.rbox(0.4, topY - waist - 0.06, 0.26, 0.04, { y: waist + 0.04 }, vest);
  for (const x of [-0.1, 0, 0.1]) b.rbox(0.075, 0.1, 0.045, 0.01, { x, y: waist + 0.1, z: 0.14 }, matte(T.vest, { jitter: 0.2 }));
  b.rbox(0.06, 0.12, 0.05, 0.01, { x: -0.13, y: waist + 0.26, z: 0.13 }, dark);
  b.cyl(0.006, 0.006, 0.12, 4, { x: -0.13, y: waist + 0.36, z: 0.13 }, dark);
  b.rbox(0.25, 0.22, 0.08, 0.02, { y: waist + 0.12, z: -0.15 }, vest); // 背包

  // 头：脸 + 头盔（护目镜带）+ 耳机
  b.bone(B.head);
  const hy = neck;
  b.cyl(0.05, 0.06, 0.1, 6, { y: hy - 0.06 }, skin);
  b.rbox(0.18, 0.23, 0.2, 0.06, { y: hy + 0.02, z: 0.01 }, skin);
  b.box(0.05, 0.012, 0.012, { x: -0.045, y: hy + 0.15, z: 0.108 }, dark);
  b.box(0.05, 0.012, 0.012, { x: 0.045, y: hy + 0.15, z: 0.108 }, dark);
  b.box(0.06, 0.012, 0.01, { y: hy + 0.06, z: 0.11 }, matte(0x6a3a2a, { ao: 0 }));
  b.sphere(0.135, 10, 6, { y: hy + 0.2, sy: 0.75 }, matte(T.helmet, { jitter: 0.08 }));
  b.box(0.27, 0.02, 0.26, { y: hy + 0.16 }, matte(T.helmet, { jitter: 0.08 }));
  b.box(0.2, 0.025, 0.02, { y: hy + 0.2, z: 0.125 }, band);
  if (variant % 2) b.rbox(0.17, 0.05, 0.04, 0.01, { y: hy + 0.25, z: 0.11 }, dark); // 护目镜
  for (const s of [-1, 1]) b.rbox(0.03, 0.07, 0.06, 0.01, { x: s * 0.105, y: hy + 0.11 }, dark);

  // 手臂
  for (const side of [0, 1] as const) {
    const sh = side === 0 ? J.shoulderL : J.shoulderR;
    const el = side === 0 ? J.elbowL : J.elbowR;
    const wr = side === 0 ? J.wristL : J.wristR;
    b.bone(side === 0 ? B.armUL : B.armUR);
    b.sphere(0.06, 7, 5, { x: sh[0], y: sh[1] - 0.02 }, cloth);
    b.rbox(0.095, sh[1] - 0.02 - el[1], 0.09, 0.025, { x: (sh[0] + el[0]) / 2, y: el[1] }, cloth);
    b.box(0.1, 0.035, 0.1, { x: (sh[0] + el[0]) / 2, y: sh[1] - 0.12 }, band); // 臂章
    b.bone(side === 0 ? B.armLL : B.armLR);
    b.sphere(0.05, 6, 4, { x: el[0], y: el[1] }, cloth);
    b.rbox(0.085, el[1] - wr[1] - 0.02, 0.08, 0.02, { x: (el[0] + wr[0]) / 2, y: wr[1] + 0.02 }, cloth);
    b.rbox(0.08, 0.1, 0.05, 0.015, { x: wr[0], y: wr[1] - 0.07 }, dark); // 手套
  }

  // 腿 + 护膝 + 靴子
  for (const side of [0, 1] as const) {
    const hp = side === 0 ? J.hipL : J.hipR;
    const kn = side === 0 ? J.kneeL : J.kneeR;
    const an = side === 0 ? J.ankleL : J.ankleR;
    b.bone(side === 0 ? B.legUL : B.legUR);
    b.sphere(0.075, 7, 5, { x: hp[0], y: hp[1] }, cloth);
    b.rbox(0.13, hp[1] - kn[1], 0.14, 0.03, { x: hp[0], y: kn[1] }, cloth);
    b.bone(side === 0 ? B.legLL : B.legLR);
    b.rbox(0.12, 0.1, 0.06, 0.02, { x: kn[0], y: kn[1] - 0.06, z: 0.06 }, dark);
    b.rbox(0.11, kn[1] - an[1] - 0.06, 0.12, 0.03, { x: kn[0], y: an[1] + 0.06 }, cloth);
    b.rbox(0.12, 0.12, 0.27, 0.03, { x: kn[0], y: 0, z: 0.06 }, matte(0x221e1a));
  }

  // 枪：挂在右手骨上（propR）。静止姿势里前臂是竖直向下的，所以枪身沿 −Y（顺着前臂往外伸）建：
  // 端枪时前臂朝前抬平，枪口就跟着朝前；枪的"上面"（瞄具）在 +Z，弹匣在 −Z。
  // 以前枪身沿 +Z 建，手臂一抬，枪口就跟着转到朝天，人机看起来像举着枪投降
  if (!armed) {
    const built = b.build();
    cache.set(key, built);
    return built;
  }
  b.bone(B.propR);
  const wr = J.wristR;
  const gx = wr[0];
  const g0 = wr[1] - 0.06;
  // （box 的 y 是底面，所以"从 a 往下伸到 b"写成 y: b、高 a − b）
  b.box(0.05, 0.5, 0.08, { x: gx, y: g0 - 0.38 }, metal(0x2a2c30)); // 机匣 + 护木：手腕往前 0.38，往后 0.12
  b.box(0.035, 0.26, 0.035, { x: gx, y: g0 - 0.64, z: 0.015 }, metal(0x1c1e20)); // 枪管
  b.box(0.04, 0.07, 0.15, { x: gx, y: g0 - 0.2, z: -0.1 }, metal(0x202224)); // 弹匣（朝下）
  b.box(0.045, 0.2, 0.1, { x: gx, y: g0 + 0.1, z: -0.03 }, matte(0x2c2a26)); // 枪托（往后顶在肩窝）
  b.box(0.03, 0.08, 0.03, { x: gx, y: g0 - 0.2, z: 0.06 }, dark); // 瞄具（朝上）
  void rng;
  const built = b.build();
  cache.set(key, built);
  return built;
}

/** 不带枪的士兵几何体（给别的场景当玩家角色用，例如雨夜街角） */
export function soldierBody(team: 0 | 1, variant: number): Built {
  return soldierGeometry(team, variant, false);
}
export const SOLDIER_JOINTS: Joints = J;

/** 枪口位置（右手骨局部，开火火光用） */
const MUZZLE = new Vector3(J.wristR[0], J.wristR[1] - 0.06 - 0.64, 0.032);
/** 左手要扶的护木位置（右手骨局部） */
const FOREGRIP = new Vector3(J.wristR[0], J.wristR[1] - 0.06 - 0.3, -0.02);

interface SActor {
  actor: RigActor;
  s: Soldier;
  flash: Mesh;
  hurt: number;
  /** 死亡倒地动画进度 0–1（活着为 -1） */
  dead: number;
  deadYaw: number;
}

const FLASH_GEO = new PlaneGeometry(0.28, 0.28);
const _v = new Vector3();
const _hint = new Vector3(-0.6, -1, 0.3);

/** 把团队死斗里的士兵同步成骨骼模型 */
export class SoldierViews {
  private readonly items = new Map<number, SActor>();
  private readonly off: Array<() => void> = [];
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
  ) {
    this.off.push(
      game.events.on('soldierShot', ({ id }) => {
        const a = this.items.get(id);
        if (a) a.flash.visible = true;
      }),
      game.events.on('soldierHit', ({ id }) => {
        const a = this.items.get(id);
        if (a) a.hurt = 1;
      }),
    );
  }

  private ensure(s: Soldier): SActor {
    let a = this.items.get(s.id);
    if (!a) {
      const actor = new RigActor(soldierGeometry(s.team, s.id % 4), Mats, J as Joints, Mats.flash);
      const flash = new Mesh(FLASH_GEO, new MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      flash.position.copy(MUZZLE);
      flash.visible = false;
      actor.bone(B.propR).add(flash);
      this.scene.add(actor.group);
      a = { actor, s, flash, hurt: 0, dead: -1, deadYaw: 0 };
      this.items.set(s.id, a);
    }
    return a;
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.game.tdm.soldiers) {
      const a = this.ensure(s);
      const g = a.actor.group;
      // 死亡：向后倒下、几秒后消失，复活时重新出现
      if (!s.alive) {
        if (a.dead < 0) {
          a.dead = 0;
          a.deadYaw = s.yaw;
        }
        a.dead = Math.min(1, a.dead + dt * 2.5);
        g.rotation.set(0, 0, 0);
        g.rotation.order = 'YXZ';
        g.rotation.y = a.deadYaw;
        g.rotation.x = -Math.PI / 2 * (a.dead * a.dead);
        g.position.y = 0.15 * a.dead;
        g.visible = s.respawnT > 0.6;
        a.flash.visible = false;
        continue;
      }
      a.dead = -1;
      g.visible = true;
      g.rotation.set(0, s.yaw, 0);
      g.position.set(s.x, 0, s.z);
      a.hurt = Math.max(0, a.hurt - dt * 5);
      a.actor.setFlash(a.hurt > 0.6);
      // 出生无敌：半透明闪烁
      for (const m of a.actor.meshes) m.visible = s.spawnShield <= 0 || Math.sin(this.time * 30) > -0.3;
      this.pose(a, dt);
      if (a.flash.visible && s.sinceShot > 0.05) a.flash.visible = false;
      if (a.flash.visible) a.flash.rotation.z = Math.random() * 6.28;
    }
  }

  private pose(a: SActor, dt: number): void {
    const { actor, s } = a;
    const bone = (i: number) => actor.bone(i);
    actor.resetPose();
    const speed = Math.hypot(s.vx, s.vz);
    const move = Math.min(1, speed / 2.5);
    const ph = s.walkPhase;
    const sn = Math.sin(ph);
    const cs = Math.cos(ph);
    const crouch = s.crouch ? 1 : 0;
    // 腿：走路摆腿；蹲下时大腿前抬、小腿后折
    bone(B.legUL).rotation.x = sn * 0.6 * move - 1.1 * crouch;
    bone(B.legUR).rotation.x = -sn * 0.6 * move - 0.3 * crouch;
    bone(B.legLL).rotation.x = Math.max(0, -cs) * 0.9 * move + 1.6 * crouch;
    bone(B.legLR).rotation.x = Math.max(0, cs) * 0.9 * move + 1.3 * crouch;
    const pelvis = bone(B.pelvis);
    pelvis.position.y = actor.pelvisBaseY - 0.04 * move * (0.5 - 0.5 * Math.cos(2 * ph)) - 0.38 * crouch;
    // 上身：朝瞄准方向扭过去（身体朝走路方向时也能侧着开枪），枪口跟着俯仰
    let twist = s.aimYaw - s.yaw;
    while (twist > Math.PI) twist -= Math.PI * 2;
    while (twist < -Math.PI) twist += Math.PI * 2;
    twist = Math.max(-1.2, Math.min(1.2, twist));
    const chest = bone(B.chest);
    chest.rotation.y = twist;
    chest.rotation.x = 0.08 + 0.1 * crouch - s.aimPitch * 0.4;
    bone(B.head).rotation.x = -s.aimPitch * 0.5 - 0.05;
    // 开枪后坐：上身往后一顿
    const kick = Math.max(0, 1 - s.sinceShot / 0.08);
    chest.rotation.x -= 0.05 * kick;
    // 换弹：枪往下压
    const reload = s.reloadT > 0 ? 1 : 0;
    // 右臂：把枪端在胸前（肩膀抬起、肘部弯曲），换弹时放低
    bone(B.armUR).rotation.set(-1.25 + 0.5 * reload - s.aimPitch * 0.8, 0.25, -0.15);
    bone(B.armLR).rotation.set(-0.35, 0, 0);
    // 受击后仰
    if (a.hurt > 0) {
      chest.rotation.x -= 0.25 * a.hurt;
      bone(B.head).rotation.x -= 0.3 * a.hurt;
    }
    // 左手扶护木（IK）：把护木位置换到 chest 局部坐标
    actor.group.updateMatrixWorld(true);
    _v.copy(FOREGRIP);
    bone(B.propR).localToWorld(_v);
    chest.worldToLocal(_v);
    actor.solveArm(0, _v, _hint);
    void dt;
  }

  dispose(): void {
    for (const f of this.off) f();
    for (const a of this.items.values()) this.scene.remove(a.actor.group);
    this.items.clear();
  }
}

/** 士兵头顶的高度（给名字标签用） */
export const SOLDIER_TOP = TDM.height + 0.35;
