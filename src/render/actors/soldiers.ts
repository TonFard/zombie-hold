import { AdditiveBlending, CanvasTexture, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Scene, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from 'three';
import type { Soldier } from '../../game/entities/soldier';
import type { Game } from '../../game/sim';
import { KNIFE, NADE } from '../../game/data/shop';
import { TDM, type DroppedGun } from '../../game/systems/tdm';
import { worldGun, worldKnife, type WorldGun } from '../tacz/worldgun';
import { applyMelee, meleeItem } from './melee-clips';
import { startDeath, updateDeath, type DeathState } from './deaths';
import { B, RigActor } from './rig';
import { SOLDIER_JOINTS as J, SOLDIER_VARIANTS, soldierGeometry } from './soldier-model';
import { ZFlash, ZMats } from './zombie-models';

export { SOLDIER_JOINTS, SOLDIER_VARIANTS, soldierBody } from './soldier-model';

/**
 * 对战里的士兵怎么动：模型在 soldier-model.ts。
 * 手里拿的是和玩家一样的 TACZ 枪模（tacz/worldgun.ts），挂在胸骨上，两只手用 IK 够到握把和护木。
 * 拿刀的时候枪收起来、刀攥在右手里，挥刀的动作在 melee-clips.ts；扔雷是右手举过头往前甩；跳起来两条腿收着。
 * 死的时候用僵尸那一套倒地动画（deaths.ts），枪掉在地上（逻辑层的掉落物，能捡）。
 */

interface SActor {
  actor: RigActor;
  s: Soldier;
  /** 枪的挂点（胸骨的子节点）：握把在它的原点 */
  mount: Group;
  gun: Mesh | null;
  gunId: string;
  wg: WorldGun | null;
  flash: Group;
  hurt: number;
  /** 举枪的程度：0 = 枪口朝下端着，1 = 抵肩瞄准 */
  aim: number;
  reload: number;
  death: DeathState | null;
  deadAge: number;
  /** 刀（右手腕骨头上的子节点）：拿着刀 / 挥刀的时候显示 */
  blade: Mesh | null;
  /** 手里拿着刀的程度 0–1（枪收起来、刀拿出来） */
  knifeK: number;
  /** 攥在手里还没扔出去的雷 */
  nade: Mesh | null;
  /** 扔雷：手离开枪的程度 0–1、这一下甩到哪了 0–1（出手以后停在 1，手慢慢回到枪上） */
  throwK: number;
  throwP: number;
  /** 蹲下 / 离地的程度 0–1（逻辑层是开关，这里抹平） */
  crouch: number;
  air: number;
}

const FLASH_GEO = new PlaneGeometry(0.44, 0.44);
let flashMat: MeshBasicMaterial | null = null;
/** 枪口火光：中间亮、往外散开的一团加几道尖刺（加色混合），不是一张方片 */
function flashMaterial(): MeshBasicMaterial {
  if (flashMat) return flashMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255, 244, 214, 1)');
  g.addColorStop(0.22, 'rgba(255, 200, 110, 0.85)');
  g.addColorStop(0.55, 'rgba(255, 130, 40, 0.22)');
  g.addColorStop(1, 'rgba(255, 110, 20, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(32, 32);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    const len = i % 2 ? 22 : 31;
    const sp = ctx.createLinearGradient(0, 0, len, 0);
    sp.addColorStop(0, 'rgba(255, 230, 170, 0.9)');
    sp.addColorStop(1, 'rgba(255, 150, 50, 0)');
    ctx.fillStyle = sp;
    ctx.beginPath();
    ctx.moveTo(0, -3.5);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, 3.5);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  flashMat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });
  return flashMat;
}

/** 手雷：一个橄榄绿的小椭球（飞着的和攥在手里的共用） */
const NADE_GEO = new SphereGeometry(0.045, 10, 8).scale(1, 1.25, 1);
const NADE_MAT = new MeshStandardMaterial({ color: 0x3f4a2b, roughness: 0.55, metalness: 0.35 });

/** 肘往哪边拐：右肘朝外下方，左肘朝下 */
const HINT_R = new Vector3(-0.7, -1, -0.25);
const HINT_L = new Vector3(0.45, -1, 0.05);
/** 枪模还没加载好时左手放的地方（握把前面 26 厘米） */
const FORE_DEFAULT = new Vector3(0, 0.03, 0.26);
/** 拿刀的时候两只手在哪（胸骨的坐标：+x 是左手边，+z 朝前）：右手在右胸前，左手护在胸口 */
const KNIFE_R = new Vector3(-0.2, 0.2, 0.3);
const KNIFE_L = new Vector3(0.17, 0.24, 0.26);
/**
 * 右手在小臂骨头里的朝向（propR 的原点在手腕），和 body-mesh.ts 的 addHand 一样：前臂旋前 0.95、手腕往掌心弯 0.28。
 * 手自己的坐标：+Z 手指方向，+Y 手背，+X 拇指侧
 */
const HAND_R = ((): Matrix4 => {
  const phi = 0.95;
  const y = new Vector3(-Math.cos(phi), 0, Math.sin(phi));
  const z = new Vector3(0, -1, 0);
  return new Matrix4().makeBasis(new Vector3().crossVectors(y, z), y, z).multiply(new Matrix4().makeRotationX(0.28));
})();
/** 刀攥在拳头里（手的坐标）：刀尖从拇指那侧出去（+X），刀背朝手腕（−Z）；握把中间在掌心 */
const KNIFE_GRIP = new Matrix4().makeBasis(new Vector3(0, -1, 0), new Vector3(0, 0, -1), new Vector3(1, 0, 0));
const PALM = new Vector3(0.004, -0.027, 0.05).applyMatrix4(HAND_R);
/** 平时拿着刀：刀尖往手指那边斜过去（顺着小臂朝前上方），不是横在胸前 */
const KNIFE_REST = 0.8;
const TWISTED = [B.armUL, B.armUR, B.legUL, B.legUR];
const _r = new Vector3();
const _l = new Vector3();
const _t = new Vector3();
const _m = new Matrix4();
const _m2 = new Matrix4();
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (k: number): number => k * k * (3 - 2 * k);

let markTex: CanvasTexture | null = null;
/** 队友头顶的小三角（隔着墙也看得见，知道自己人在哪） */
function mateMark(): Sprite {
  if (!markTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#6cc0ff';
    ctx.strokeStyle = 'rgba(8, 20, 34, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(10, 14);
    ctx.lineTo(54, 14);
    ctx.lineTo(32, 52);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    markTex = new CanvasTexture(c);
  }
  const sp = new Sprite(new SpriteMaterial({ map: markTex, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8, sizeAttenuation: false, toneMapped: false }));
  sp.scale.setScalar(0.022);
  sp.renderOrder = 20;
  return sp;
}

/** 把对战里的士兵同步成骨骼模型 */
export class SoldierViews {
  private readonly items = new Map<number, SActor>();
  private readonly off: Array<() => void> = [];
  /** 每个人是怎么死的（soldierDied 事件带过来的），倒地动画用 */
  private readonly killed = new Map<number, { head: boolean; dx: number; dz: number }>();

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
  ) {
    this.off.push(
      game.events.on('soldierHit', ({ id }) => {
        const a = this.items.get(id);
        if (a) a.hurt = 1;
      }),
      game.events.on('soldierDied', ({ id, head, dx, dz }) => this.killed.set(id, { head, dx, dz })),
    );
  }

  private ensure(s: Soldier): SActor {
    let a = this.items.get(s.id);
    if (!a) {
      const actor = new RigActor(soldierGeometry(s.team, s.id % SOLDIER_VARIANTS), ZMats, J, ZFlash);
      const mount = new Group();
      actor.bone(B.chest).add(mount);
      const flash = new Group();
      const f1 = new Mesh(FLASH_GEO, flashMaterial());
      const f2 = new Mesh(FLASH_GEO, flashMaterial());
      f2.rotation.y = Math.PI / 2;
      flash.add(f1, f2);
      flash.visible = false;
      mount.add(flash);
      if (s.team === 0) {
        const mark = mateMark();
        mark.position.y = TDM.height - J.head[1] + 0.42;
        actor.bone(B.head).add(mark);
      }
      this.scene.add(actor.group);
      a = { actor, s, mount, gun: null, gunId: '', wg: null, flash, hurt: 0, aim: 0, reload: 0, death: null, deadAge: 0, blade: null, knifeK: 0, nade: null, throwK: 0, throwP: 0, crouch: 0, air: 0 };
      this.items.set(s.id, a);
    }
    return a;
  }

  /** 手里的枪换了 / 枪模加载好了：换网格（显不显示在 pose 里定：拿着刀的时候枪是收起来的） */
  private syncGun(a: SActor): void {
    const id = a.s.gun;
    if (a.gunId === id && a.wg) return;
    const wg = worldGun(id);
    if (a.gunId !== id) {
      a.gunId = id;
      a.wg = null;
    }
    if (!wg) return;
    a.wg = wg;
    if (!a.gun) {
      a.gun = new Mesh(wg.geometry, wg.material);
      a.gun.castShadow = true;
      a.mount.add(a.gun);
    } else {
      a.gun.geometry = wg.geometry;
      a.gun.material = wg.material;
    }
    a.flash.position.copy(wg.muzzle);
  }

  update(dt: number): void {
    const grid = this.game.grid;
    for (const s of this.game.tdm.soldiers) {
      const a = this.ensure(s);
      const g = a.actor.group;
      // ---- 死了：倒地动画，枪掉在地上；尸体留到这一局结束 ----
      if (!s.alive) {
        if (!a.death) {
          const k = this.killed.get(s.id) ?? { head: false, dx: Math.sin(s.yaw + Math.PI), dz: Math.cos(s.yaw + Math.PI) };
          this.killed.delete(s.id);
          a.actor.setFlash(false);
          a.flash.visible = false;
          g.rotation.order = 'YXZ';
          // 霰弹枪、狙击枪打过来的劲大一些（还不到被炸飞的程度）
          const push = 1.3;
          a.death = startDeath(a.actor, { kind: 'walker', seed: s.id * 31 + s.deaths * 17, head: k.head, x: s.x, z: s.z, yaw: s.yaw, air: s.y, kbx: k.dx * push, kbz: k.dz * push, vx: s.vx, vz: s.vz, room: (dx, dz, want) => Math.max(0, grid.rayDist(s.x, s.z, dx, dz, want + 0.15) - 0.15) });
          a.deadAge = 0;
          // 枪掉在地上由 syncDrops 画（逻辑层的 tdm.drops：能捡）；手里的东西藏起来
          if (a.gun) a.gun.visible = false;
          if (a.blade) a.blade.visible = false;
          if (a.nade) a.nade.visible = false;
        }
        a.deadAge += dt;
        updateDeath(a.actor, a.death, a.deadAge, 0);
        continue;
      }
      if (a.death) this.revive(a);
      this.syncGun(a);
      g.visible = true;
      g.rotation.set(0, s.yaw, 0);
      g.position.set(s.x, s.y, s.z);
      a.hurt = Math.max(0, a.hurt - dt * 5);
      a.actor.setFlash(a.hurt > 0.6);
      this.pose(a, dt);
      a.flash.visible = s.sinceShot < 0.05 && !!a.wg && a.knifeK < 0.5;
      if (a.flash.visible) a.flash.rotation.z = Math.random() * 6.28;
    }
    this.syncDrops();
    this.syncNades();
  }

  /** 掉在地上的枪（逻辑层的 tdm.drops）：从半空掉下来、侧躺在地上；走近了能捡 */
  private readonly dropMeshes = new Map<number, { mesh: Mesh; gun: string; ready: boolean }>();
  private syncDrops(): void {
    const drops = this.game.tdm.drops;
    for (const d of drops) {
      let m = this.dropMeshes.get(d.id);
      if (!m) {
        m = { mesh: new Mesh(), gun: d.gun, ready: false };
        m.mesh.castShadow = true;
        m.mesh.visible = false;
        this.scene.add(m.mesh);
        this.dropMeshes.set(d.id, m);
      }
      if (!m.ready) {
        const wg = worldGun(d.gun);
        if (!wg) continue;
        m.mesh.geometry = wg.geometry;
        m.mesh.material = wg.material;
        m.ready = true;
        m.mesh.visible = true;
      }
      this.placeDrop(m.mesh, d);
    }
    if (this.dropMeshes.size > drops.length) {
      for (const [id, m] of this.dropMeshes) {
        if (drops.some((d) => d.id === id)) continue;
        this.scene.remove(m.mesh);
        this.dropMeshes.delete(id);
      }
    }
  }

  private placeDrop(mesh: Mesh, d: DroppedGun): void {
    // 自由落体到地上（离地 3.5 厘米，侧躺着），落地前带着一点翻转
    const fall = Math.max(0, d.y0 - 4.9 * d.t * d.t);
    const k = d.y0 > 0 ? fall / d.y0 : 0;
    mesh.position.set(d.x, 0.035 + fall, d.z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(0.5 * k, d.yaw, (d.id % 2 ? 1 : -1) * (Math.PI / 2) * (1 - 0.7 * k));
  }

  /** 飞着的手雷 */
  private readonly nadeMeshes: Mesh[] = [];
  private syncNades(): void {
    const list = this.game.tdm.grenades;
    while (this.nadeMeshes.length < list.length) {
      const m = new Mesh(NADE_GEO, NADE_MAT);
      m.castShadow = true;
      this.scene.add(m);
      this.nadeMeshes.push(m);
    }
    this.nadeMeshes.forEach((m, i) => {
      const n = list[i];
      m.visible = !!n;
      if (!n) return;
      m.position.set(n.x, n.y, n.z);
      m.rotation.set(n.fuse * 9, n.fuse * 5, 0);
    });
  }

  /** 新的一局：站起来，枪回到手里 */
  private revive(a: SActor): void {
    a.death = null;
    a.actor.resetPose();
    for (const i of TWISTED) a.actor.bone(i).rotation.order = 'XYZ';
    a.actor.group.rotation.order = 'XYZ';
    a.aim = 0;
    a.hurt = 0;
    a.knifeK = 0;
    a.throwK = 0;
    a.crouch = 0;
    a.air = 0;
  }

  /** 刀、攥着的雷：用到的时候才建（挂在右手腕的骨头上） */
  private handItems(a: SActor, wantNade: boolean): void {
    if (!a.blade) {
      const k = worldKnife();
      if (k) {
        a.blade = new Mesh(k.geometry, k.material);
        a.blade.castShadow = true;
        a.blade.position.copy(PALM);
        a.blade.visible = false;
        a.actor.bone(B.propR).add(a.blade);
      }
    }
    if (!a.nade && wantNade) {
      a.nade = new Mesh(NADE_GEO, NADE_MAT);
      a.nade.position.copy(PALM);
      a.actor.bone(B.propR).add(a.nade);
    }
  }

  private pose(a: SActor, dt: number): void {
    const { actor, s, mount } = a;
    const bone = (i: number) => actor.bone(i);
    actor.resetPose();
    const speed = Math.hypot(s.vx, s.vz);
    const move = Math.min(1, speed / 2.5);
    const ph = s.walkPhase;
    const sn = Math.sin(ph);
    const cs = Math.cos(ph);
    a.crouch += ((s.crouch ? 1 : 0) - a.crouch) * Math.min(1, dt * 11);
    // 竖直速度不是 0 = 在半空（站在箱子顶上的时候是 0）
    a.air += ((s.vy !== 0 ? 1 : 0) - a.air) * Math.min(1, dt * 14);
    const crouch = a.crouch;
    const air = a.air;
    const gnd = 1 - air;
    // 腿：走路摆腿；蹲下时大腿前抬、小腿后折；跳起来两条腿收着（一前一后）
    bone(B.legUL).rotation.x = (sn * 0.6 * move - 1.1 * crouch) * gnd - 0.95 * air;
    bone(B.legUR).rotation.x = (-sn * 0.6 * move - 0.3 * crouch) * gnd - 0.3 * air;
    bone(B.legLL).rotation.x = (Math.max(0, -cs) * 0.9 * move + 1.6 * crouch) * gnd + 1.35 * air;
    bone(B.legLR).rotation.x = (Math.max(0, cs) * 0.9 * move + 1.3 * crouch) * gnd + 0.85 * air;
    const pelvis = bone(B.pelvis);
    pelvis.position.y = actor.pelvisBaseY - (0.04 * move * (0.5 - 0.5 * Math.cos(2 * ph)) + 0.38 * crouch) * gnd;
    // 上身：朝瞄准方向扭过去（身体朝走路方向时也能侧着开枪），枪口跟着俯仰
    let twist = s.aimYaw - s.yaw;
    while (twist > Math.PI) twist -= Math.PI * 2;
    while (twist < -Math.PI) twist += Math.PI * 2;
    twist = Math.max(-1.2, Math.min(1.2, twist));
    const chest = bone(B.chest);
    chest.rotation.y = twist;
    chest.rotation.x = 0.1 + 0.1 * crouch + 0.1 * air - s.aimPitch * 0.4;
    // 开枪后坐：上身往后一顿
    const kick = Math.max(0, 1 - s.sinceShot / 0.08);
    chest.rotation.x -= 0.05 * kick;
    // 受击后仰
    if (a.hurt > 0) chest.rotation.x -= 0.25 * a.hurt;

    // ---- 手里是什么：刀（枪收起来）、正在扔雷（右手离开枪）、刚掏出枪（枪口还朝下） ----
    const swinging = s.meleeT >= 0;
    a.knifeK += ((s.knife || swinging ? 1 : 0) - a.knifeK) * Math.min(1, dt * (swinging ? 30 : 11));
    const kn = a.knifeK;
    const throwing = s.throwT > 0;
    if (throwing) a.throwP = Math.max(0, 1 - s.throwT / NADE.windup);
    a.throwK += ((throwing ? 1 : 0) - a.throwK) * Math.min(1, dt * (throwing ? 18 : 6));
    const th = a.throwK;
    const draw = Math.min(1, s.drawT / 0.3);
    this.handItems(a, throwing);

    // ---- 枪：有目标 / 刚开过枪就抵肩瞄准，平时枪口朝下端着；换弹、掏枪、扔雷时压低 ----
    const wantAim = s.brain.target !== null || s.sinceShot < 1.2 ? 1 : 0;
    a.aim += (wantAim - a.aim) * Math.min(1, dt * 9);
    a.reload += ((s.reloadT > 0 ? 1 : 0) - a.reload) * Math.min(1, dt * 10);
    const aim = a.aim * (1 - draw) * (1 - th);
    const pistol = s.weapon === 'pistol';
    const down = (pistol ? 0.75 : 0.55) * (1 - aim) + 0.5 * a.reload + 0.45 * draw + 0.3 * th;
    if (pistol) mount.position.set(lerp(-0.06, -0.03, aim), lerp(0.2, 0.43, aim) - 0.08 * a.reload - 0.1 * draw, lerp(0.3, 0.44, aim) - 0.03 * kick);
    else mount.position.set(-0.085, lerp(0.25, 0.375, aim) - 0.05 * a.reload - 0.08 * draw, lerp(0.21, 0.2, aim) - 0.025 * kick);
    // 胸骨自己已经带着一部分俯仰，枪再补上剩下的，合起来就是瞄准的俯仰
    mount.rotation.set(-s.aimPitch + down - chest.rotation.x - 0.04 * kick, pistol ? 0.04 : 0.07, 0);
    mount.updateMatrix();
    if (a.gun) a.gun.visible = !!a.wg && kn < 0.5;
    // 头：看着瞄的方向；抵肩时往枪上靠一点
    const head = bone(B.head);
    head.rotation.x = -s.aimPitch * 0.5 - 0.05 - 0.3 * a.hurt;
    head.rotation.z = pistol ? 0 : -0.1 * aim * (1 - kn);

    // 右手握把：手腕在握把后下方一点（手掌在手腕前面）
    _r.set(0.012, -0.04, -0.055).applyMatrix4(mount.matrix);
    if (kn > 0) _r.lerp(_t.copy(KNIFE_R), kn);
    if (th > 0) {
      // 扔雷：抬手往后引（前六成），再往前上方甩出去
      const p = a.throwP;
      const back = p < 0.6 ? ease(p / 0.6) : 1 - ease((p - 0.6) / 0.4);
      const fwd = p < 0.6 ? 0 : ease((p - 0.6) / 0.4);
      _r.lerp(_t.set(-0.3 + 0.08 * fwd, 0.58 + 0.06 * fwd, -0.2 * back + 0.42 * fwd), th);
      chest.rotation.y += (-0.35 * back + 0.3 * fwd) * th;
    }
    actor.solveArm(1, _r, HINT_R);
    // 左手：长枪扶护木（换弹时去够弹匣），手枪托在右手下面；拿刀的时候护在胸口
    if (pistol) _l.set(0.04, -0.05, -0.045);
    else {
      _l.copy(a.wg ? a.wg.fore : FORE_DEFAULT);
      _l.y -= 0.045;
      _l.z -= 0.035;
      _l.lerp(_t.set(0.01, -0.14, 0.09), a.reload * 0.85);
    }
    _l.applyMatrix4(mount.matrix);
    if (kn > 0) _l.lerp(_t.copy(KNIFE_L), kn);
    actor.solveArm(0, _l, HINT_L);

    // ---- 挥刀：在上面的姿势上叠挥的动作 ----
    const dur = s.meleeKind === 2 ? KNIFE.stab.dur : KNIFE.slash.dur;
    if (swinging) applyMelee(actor, s.meleeKind, s.meleeT, dur);
    if (a.blade) {
      a.blade.visible = kn >= 0.5;
      if (a.blade.visible) {
        // 挥的时候手腕压下去，刀尖顺着小臂伸出去；横挥时刀刃朝挥的方向
        let along = KNIFE_REST;
        let roll = 0;
        if (swinging) {
          const it = meleeItem(s.meleeKind, s.meleeT, dur);
          along = lerp(KNIFE_REST, 1.15, it.along);
          roll = it.roll;
        }
        _m.copy(HAND_R).multiply(_m2.makeRotationY(-along)).multiply(KNIFE_GRIP).multiply(_m2.makeRotationZ(roll));
        a.blade.quaternion.setFromRotationMatrix(_m);
      }
    }
    if (a.nade) a.nade.visible = throwing && a.throwP < 0.97;
  }

  dispose(): void {
    for (const f of this.off) f();
    for (const a of this.items.values()) {
      this.scene.remove(a.actor.group);
      if (a.gun) a.gun.removeFromParent();
      if (a.blade) a.blade.removeFromParent();
      if (a.nade) a.nade.removeFromParent();
    }
    this.items.clear();
    for (const m of this.dropMeshes.values()) this.scene.remove(m.mesh);
    this.dropMeshes.clear();
    for (const m of this.nadeMeshes) this.scene.remove(m);
    this.nadeMeshes.length = 0;
  }
}

/** 士兵头顶的高度（给名字标签用） */
export const SOLDIER_TOP = TDM.height + 0.35;
