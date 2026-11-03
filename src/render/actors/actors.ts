import { Color, Mesh, MeshBasicMaterial, RingGeometry, Scene } from 'three';
import { clamp } from '../../game/core/math';
import { ZOMBIES } from '../../game/data/zombies';
import type { Zombie } from '../../game/entities/zombie';
import type { Game } from '../../game/sim';
import { ATTACK_TIME, poseZombie } from './poses';
import { B, type RigActor } from './rig';
import { MODEL_SCALE, createZombieActor } from './zombie-models';

interface ZActor {
  actor: RigActor;
  zombie: Zombie;
  /** 距离上一次攻击命中过了多久（秒） */
  sinceHit: number;
  hp: number;
  flinch: number;
}

interface Corpse {
  actor: RigActor;
  age: number;
  side: number;
  yaw: number;
  scale: number;
}

const MAX_CORPSES = 36;
const ease = (x: number) => x * x * (3 - 2 * x);

/** 把逻辑层的僵尸同步成骨骼模型，驱动动画（第一人称不画玩家身体，手和枪由视角模型负责） */
const ELITE_RING = new RingGeometry(0.42, 0.55, 32);
const ELITE_MAT = new MeshBasicMaterial({ color: new Color(3, 2.1, 0.5), transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, side: 2 });

export class Actors {
  private readonly zombies = new Map<number, ZActor>();
  private readonly corpses: Corpse[] = [];
  private time = 0;
  private readonly off: Array<() => void> = [];

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
  ) {
    this.off.push(
      game.events.on('zombieAttack', ({ zombie }) => {
        const za = this.zombies.get(zombie.id);
        if (za) za.sinceHit = 0;
      }),
      game.events.on('zombieDied', ({ zombie }) => this.kill(zombie)),
    );
  }

  private ensure(z: Zombie): ZActor {
    let za = this.zombies.get(z.id);
    if (!za) {
      const actor = createZombieActor(z.kind, z.seed);
      // 精英：大一圈，脚下一个金色光环
      if (z.elite) {
        actor.group.scale.multiplyScalar(1.15);
        const halo = new Mesh(ELITE_RING, ELITE_MAT);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.04;
        actor.group.add(halo);
      }
      this.scene.add(actor.group);
      za = { actor, zombie: z, sinceHit: 99, hp: z.hp, flinch: 0 };
      this.zombies.set(z.id, za);
    }
    return za;
  }

  private kill(z: Zombie): void {
    const za = this.zombies.get(z.id) ?? this.ensure(z);
    this.zombies.delete(z.id);
    za.actor.setFlash(false);
    za.actor.group.rotation.order = 'YXZ';
    this.corpses.push({
      actor: za.actor,
      age: 0,
      side: (z.seed % 2 ? 1 : -1) * (0.15 + (z.seed % 7) * 0.04),
      yaw: z.yaw,
      scale: MODEL_SCALE[z.kind],
    });
    while (this.corpses.length > MAX_CORPSES) this.removeCorpse(0);
  }

  private removeCorpse(i: number): void {
    const c = this.corpses[i];
    if (!c) return;
    this.scene.remove(c.actor.group);
    this.corpses.splice(i, 1);
  }

  update(dt: number): void {
    this.time += dt;
    const { game } = this;

    // ---- 活着的僵尸 ----
    for (const z of game.zombies) {
      if (!z.alive) continue;
      const za = this.ensure(z);
      za.zombie = z;
      za.sinceHit += dt;
      if (z.hp < za.hp) za.flinch = 1;
      za.hp = z.hp;
      za.flinch = Math.max(0, za.flinch - dt * 5);

      const T = ATTACK_TIME[z.kind];
      let attack = -1;
      if (za.sinceHit < 0.53 * T) attack = 0.47 + za.sinceHit / T;
      else if (z.state === 'attack' && z.attackTimer < 0.47 * T) attack = (0.47 * T - z.attackTimer) / T;

      const a = za.actor;
      a.group.position.set(z.x, 0, z.z);
      a.group.rotation.y = z.yaw;
      poseZombie(a, {
        kind: z.kind,
        t: this.time,
        phase: z.walkPhase,
        speed: Math.hypot(z.vx, z.vz),
        maxSpeed: ZOMBIES[z.kind].speed,
        attack,
        flinch: za.flinch,
        seed: z.seed % 1000,
      });
      a.setFlash(z.hitFlash > 0);
    }
    // 逻辑层已移除、但没有死亡事件的僵尸（例如调试清场）
    const alive = new Set<number>();
    for (const z of game.zombies) alive.add(z.id);
    for (const [id, za] of this.zombies) {
      if (!alive.has(id)) {
        this.scene.remove(za.actor.group);
        this.zombies.delete(id);
      }
    }

    // ---- 尸体 ----
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i] as Corpse;
      c.age += dt;
      const a = c.actor;
      const fall = ease(clamp(c.age / 0.65, 0, 1));
      a.group.rotation.set(-fall * Math.PI * 0.5, c.yaw, c.side * fall);
      a.group.position.y = 0.15 * c.scale * fall - Math.max(0, c.age - 6) * 0.25;
      a.bone(B.armUL).rotation.set(-0.3 * fall, 0, 0.85 * fall);
      a.bone(B.armUR).rotation.set(-0.5 * fall, 0, -0.7 * fall);
      a.bone(B.armLL).rotation.x = -0.5 * fall;
      a.bone(B.armLR).rotation.x = -0.3 * fall;
      a.bone(B.legUL).rotation.set(0.1 * fall, 0, 0.3 * fall);
      a.bone(B.legUR).rotation.set(-0.2 * fall, 0, -0.22 * fall);
      a.bone(B.legLL).rotation.x = 0.3 * fall;
      a.bone(B.head).rotation.set(0.35 * fall, 0, 0.2 * fall);
      a.bone(B.chest).rotation.x = 0;
      if (c.age > 9) this.removeCorpse(i);
    }

  }

  dispose(): void {
    for (const f of this.off) f();
  }
}
