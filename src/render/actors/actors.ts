import { Color, Mesh, MeshBasicMaterial, RingGeometry, Scene, Vector3, type Group } from 'three';
import { clamp } from '../../game/core/math';
import { ELITE_SCALE } from '../../game/data/modifiers';
import { ZOMBIES } from '../../game/data/zombies';
import type { Zombie } from '../../game/entities/zombie';
import type { Game } from '../../game/sim';
import { ATTACK_TIME, poseZombie } from './poses';
import { B, type RigActor } from './rig';
import { GlbZombie, hasZombieModel } from './zombie-glb';
import { MODEL_SCALE, attachParts, createZombieActor, type ZombieParts } from './zombie-models';
import { skillPose } from '../../game/systems/boss';

interface ZActor {
  /** 程序僵尸（写实模型没加载好时用）和写实僵尸二选一 */
  actor: RigActor | null;
  glb: GlbZombie | null;
  /** 能单独藏起来的部件（重装的钢板、母巢的卵囊），只有程序僵尸有 */
  parts: ZombieParts | null;
  group: Group;
  zombie: Zombie;
  /** 距离上一次攻击命中过了多久（秒） */
  sinceHit: number;
  /** 距离上一次嘶吼过了多久（秒） */
  sinceScream: number;
  hp: number;
  flinch: number;
}

interface Corpse {
  actor: RigActor | null;
  glb: GlbZombie | null;
  group: Group;
  age: number;
  side: number;
  yaw: number;
  scale: number;
  /** 爆头击杀：脖子断口还要冒多久的血（秒） */
  spurt: number;
  spurtAcc: number;
}

const MAX_CORPSES = 36;
/** 爆头击杀后断口冒血的时长（秒）：开头最猛，越来越少 */
const SPURT_TIME = 1.3;
/** 嘶吼动作的时长（秒） */
const SCREAM_TIME = 1.3;
const ease = (x: number) => x * x * (3 - 2 * x);

/** 把逻辑层的僵尸同步成骨骼模型，驱动动画（第一人称不画玩家身体，手和枪由视角模型负责） */
const ELITE_RING = new RingGeometry(0.42, 0.55, 32);
const ELITE_MAT = new MeshBasicMaterial({ color: new Color(3, 2.1, 0.5), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, side: 2 });

export class Actors {
  private readonly zombies = new Map<number, ZActor>();
  /** 僵尸投影：只在高画质开（view.setQuality 设） */
  shadows = true;
  private readonly corpses: Corpse[] = [];
  private time = 0;
  private readonly off: Array<() => void> = [];
  private readonly neck = new Vector3();
  /** 断口冒血的粒子由特效层画（特效层比这里晚创建，view.ts 里接上） */
  neckSpurt: ((x: number, y: number, z: number) => void) | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
  ) {
    this.off.push(
      game.events.on('zombieAttack', ({ zombie }) => {
        const za = this.zombies.get(zombie.id);
        if (za) za.sinceHit = 0;
      }),
      game.events.on('zombieDied', ({ zombie, head }) => this.kill(zombie, head)),
      // 嘶吼事件只带位置：找站在那个位置上的尖啸者
      game.events.on('scream', ({ x, z }) => {
        for (const za of this.zombies.values()) {
          if (za.zombie.def.scream && Math.abs(za.zombie.x - x) < 0.01 && Math.abs(za.zombie.z - z) < 0.01) za.sinceScream = 0;
        }
      }),
    );
  }

  private ensure(z: Zombie): ZActor {
    let za = this.zombies.get(z.id);
    if (!za) {
      const glb = hasZombieModel(z.kind) ? new GlbZombie(z.kind, z.seed) : null;
      const actor = glb ? null : createZombieActor(z.kind, z.seed);
      const parts = actor ? attachParts(actor, z.kind) : null;
      const group = glb ? glb.group : (actor as RigActor).group;
      // 精英：大一圈（命中体积跟着同一个倍数放大），脚下一个金色光环
      if (z.elite) {
        group.scale.multiplyScalar(ELITE_SCALE);
        const halo = new Mesh(ELITE_RING, ELITE_MAT);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.04;
        group.add(halo);
      }
      this.scene.add(group);
      za = { actor, glb, parts, group, zombie: z, sinceHit: 99, sinceScream: 99, hp: z.hp, flinch: 0 };
      this.zombies.set(z.id, za);
    }
    return za;
  }

  private kill(z: Zombie, head: boolean): void {
    const za = this.zombies.get(z.id) ?? this.ensure(z);
    this.zombies.delete(z.id);
    za.actor?.setFlash(false);
    za.glb?.die(z.seed, head);
    // 爆头击杀：头没了（头骨骼缩到脖子顶上那一点），尸体照常倒下
    if (head) za.actor?.bone(B.head).scale.setScalar(0.001);
    za.group.rotation.order = 'YXZ';
    this.corpses.push({
      actor: za.actor,
      glb: za.glb,
      group: za.group,
      age: 0,
      side: (z.seed % 2 ? 1 : -1) * (0.15 + (z.seed % 7) * 0.04),
      yaw: z.yaw,
      scale: MODEL_SCALE[z.kind],
      spurt: head ? SPURT_TIME : 0,
      spurtAcc: 1,
    });
    while (this.corpses.length > MAX_CORPSES) this.removeCorpse(0);
  }

  private removeCorpse(i: number): void {
    const c = this.corpses[i];
    if (!c) return;
    this.scene.remove(c.group);
    c.glb?.dispose();
    this.corpses.splice(i, 1);
  }

  update(dt: number): void {
    this.time += dt;
    const { game } = this;
    const px = game.player.x;
    const pz = game.player.z;

    // ---- 活着的僵尸 ----
    // 投影（M19）：场上超过 40 只、或者画质不是高的时候，僵尸都不投影（阴影那一遍的绘制调用接近减半）
    let living = 0;
    for (const z of game.zombies) if (z.alive) living++;
    const cast = this.shadows && living <= 40;
    for (const z of game.zombies) {
      if (!z.alive) continue;
      const za = this.ensure(z);
      za.zombie = z;
      za.sinceHit += dt;
      za.sinceScream += dt;
      if (z.hp < za.hp) za.flinch = 1;
      za.hp = z.hp;
      za.flinch = Math.max(0, za.flinch - dt * 5);

      const T = ATTACK_TIME[z.kind];
      let attack = -1;
      if (za.sinceHit < 0.53 * T) attack = 0.47 + za.sinceHit / T;
      else if (z.state === 'attack' && z.attackTimer < 0.47 * T) attack = (0.47 * T - z.attackTimer) / T;

      za.group.position.set(z.x, z.airY, z.z);
      za.group.rotation.y = z.yaw;
      const sp = skillPose(z);
      if (za.glb) {
        // 嘶吼：尖啸者叫的时候；巨像冲锋前蓄力的时候；首领尖啸 / 咆哮蓄力的时候
        let scream = za.sinceScream < SCREAM_TIME ? za.sinceScream / SCREAM_TIME : -1;
        const ch = z.def.charge;
        if (ch && z.chargeState === 1) scream = clamp(1 - z.chargeT / ch.windup, 0, 1);
        if ((sp.name === 'shriek' || sp.name === 'howl') && sp.k < 1) scream = sp.k;
        za.glb.setCastShadow(cast);
        za.glb.update(dt, z, { attack, flinch: za.flinch, scream, dist: Math.hypot(z.x - px, z.z - pz) });
        za.glb.setFlash(z.hitFlash > 0);
        continue;
      }
      const a = za.actor as RigActor;
      a.setCastShadow(cast);
      poseZombie(a, {
        kind: z.kind,
        t: this.time,
        phase: z.walkPhase,
        speed: Math.hypot(z.vx, z.vz),
        maxSpeed: ZOMBIES[z.kind].speed,
        attack,
        flinch: za.flinch,
        seed: z.seed % 1000,
        crouch: z.leapState === 1 && z.def.leap ? z.leapT / z.def.leap.windup : 0,
        air: z.leapState === 2 ? z.leapT / z.leapDur : -1,
        skill: sp.name,
        skillK: sp.k,
      });
      if (za.parts) {
        if (za.parts.plate) za.parts.plate.visible = z.plateHp > 0;
        za.parts.sacs.forEach((s, k) => (s.visible = k < z.sacs));
      }
      a.setFlash(z.hitFlash > 0);
    }
    // 逻辑层已移除、但没有死亡事件的僵尸（例如调试清场）
    const alive = new Set<number>();
    for (const z of game.zombies) alive.add(z.id);
    for (const [id, za] of this.zombies) {
      if (!alive.has(id)) {
        this.scene.remove(za.group);
        za.glb?.dispose();
        this.zombies.delete(id);
      }
    }

    // ---- 尸体 ----
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i] as Corpse;
      c.age += dt;
      if (c.age > 9) {
        this.removeCorpse(i);
        continue;
      }
      // 6 秒后沉进地里
      const sink = Math.max(0, c.age - 6) * 0.25;
      if (c.glb) {
        c.glb.updateDead(dt, Math.hypot(c.group.position.x - px, c.group.position.z - pz));
        c.group.position.y = -sink;
        this.spurt(c, dt);
        continue;
      }
      const a = c.actor as RigActor;
      const fall = ease(clamp(c.age / 0.65, 0, 1));
      a.group.rotation.set(-fall * Math.PI * 0.5, c.yaw, c.side * fall);
      a.group.position.y = 0.15 * c.scale * fall - sink;
      a.bone(B.armUL).rotation.set(-0.3 * fall, 0, 0.85 * fall);
      a.bone(B.armUR).rotation.set(-0.5 * fall, 0, -0.7 * fall);
      a.bone(B.armLL).rotation.x = -0.5 * fall;
      a.bone(B.armLR).rotation.x = -0.3 * fall;
      a.bone(B.legUL).rotation.set(0.1 * fall, 0, 0.3 * fall);
      a.bone(B.legUR).rotation.set(-0.2 * fall, 0, -0.22 * fall);
      a.bone(B.legLL).rotation.x = 0.3 * fall;
      a.bone(B.head).rotation.set(0.35 * fall, 0, 0.2 * fall);
      a.bone(B.chest).rotation.x = 0;
      this.spurt(c, dt);
    }
  }

  /** 爆头击杀的尸体：脖子断口跟着倒地的身体往外冒血，每秒 45 滴起步，1.3 秒里减到没有 */
  private spurt(c: Corpse, dt: number): void {
    if (c.spurt <= 0 || !this.neckSpurt) return;
    c.spurtAcc += dt * 45 * (c.spurt / SPURT_TIME);
    c.spurt -= dt;
    if (c.spurtAcc < 1) return;
    const v = this.neck;
    if (c.glb) {
      if (!c.glb.neck(v)) {
        c.spurt = 0;
        return;
      }
    } else (c.actor as RigActor).bone(B.head).getWorldPosition(v);
    for (; c.spurtAcc >= 1; c.spurtAcc--) this.neckSpurt(v.x, v.y, v.z);
  }

  dispose(): void {
    for (const f of this.off) f();
  }
}
