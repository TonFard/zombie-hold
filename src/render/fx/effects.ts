import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { Rng } from '../../game/core/rng';
import type { WeaponKind } from '../../game/data/weapons';
import type { Projectile } from '../../game/entities/projectile';
import type { Game } from '../../game/sim';
import type { CameraRig } from '../core/cameraRig';
import { Builder, toGroup } from '../kit';
import { MODEL_SCALE } from '../actors/zombie-models';
import type { ViewModel } from '../weapons/viewmodel';
import { Decals } from './decals';
import { FloatingText } from './floatingText';
import { Particles } from './particles';

const SHAKE: Record<WeaponKind, number> = { pistol: 0.07, smg: 0.05, shotgun: 0.26, rifle: 0.09, sniper: 0.3, lmg: 0.08, launcher: 0.34 };
/** 枪口火光照亮前方世界的点光源峰值 */
const FLASH_LIGHT: Record<WeaponKind, number> = { pistol: 16, smg: 14, shotgun: 46, rifle: 20, sniper: 40, lmg: 24, launcher: 54 };

/**
 * 开枪时相机额外的一下"顿挫"（弧度，很快回弹，只影响画面）。
 * 真正的后坐力在逻辑层（player.kickPitch），会实际抬高弹着点。
 */
const KICK: Record<WeaponKind, number> = { pistol: 0.006, smg: 0.003, shotgun: 0.022, rifle: 0.006, sniper: 0.03, lmg: 0.004, launcher: 0.03 };

interface Tracer {
  mesh: Mesh;
  age: number;
  life: number;
}

interface Boom {
  fire: Mesh;
  ring: Mesh;
  age: number;
  radius: number;
}

/** 战斗特效：枪口火光、曳光、命中、爆炸、血迹、伤害数字…… 全部由逻辑层事件驱动 */
export class Effects {
  readonly particles = new Particles();
  readonly decals = new Decals();
  readonly text: FloatingText;

  private readonly rng = new Rng(2024);
  private readonly off: Array<() => void> = [];
  private readonly flashLight = new PointLight(0xffa860, 0, 9, 2);
  private flashT = 0;
  private flashPeak = 0;
  private readonly boomLight = new PointLight(0xff8a3a, 0, 16, 2);
  private boomT = 0;
  private readonly tracers: Tracer[] = [];
  private tracerIdx = 0;
  private readonly bulletMeshes: Mesh[] = [];
  private readonly bulletOff = new Map<number, Vector3>();
  private readonly bulletSeen = new Set<number>();
  private readonly booms: Boom[] = [];
  private readonly grenades = new Map<Projectile, Group>();
  private readonly grenadeProto: Group;
  /** 最近一次开枪时枪口的世界坐标，曳光从这里出发 */
  private readonly muzzle = new Vector3();
  private readonly ta = new Vector3();
  private readonly tb = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
    private readonly rig: CameraRig,
    private readonly viewmodel: ViewModel,
    container: HTMLElement,
    camera: PerspectiveCamera,
    size: () => { w: number; h: number },
  ) {
    this.text = new FloatingText(container, camera, size);
    scene.add(this.particles.mesh);
    scene.add(this.decals.group);

    // 枪口火光的面片在视角模型里；这里只留一盏短命点光源照亮前方的地面和墙
    scene.add(this.flashLight);
    scene.add(this.boomLight);

    // 曳光池
    const tg = new BoxGeometry(1, 1, 1);
    const tm = new MeshBasicMaterial({ color: new Color(3.2, 2.4, 1.3), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 40; i++) {
      const m = new Mesh(tg, tm.clone());
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, age: 0, life: 0 });
    }
    // 子弹曳光池：同屏最多 96 颗（霰弹一发 10 颗，连发时也够）
    const bm = new MeshBasicMaterial({ color: new Color(3.4, 2.5, 1.3), toneMapped: false, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 96; i++) {
      const m = new Mesh(tg, bm);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.bulletMeshes.push(m);
    }

    // 榴弹外形
    const gb = new Builder();
    gb.cyl(0.055, 0.055, 0.22, 8, { rx: Math.PI / 2 }, { color: 0x3a3f33, mat: 'metal', jitter: 0.1, ao: 0 });
    gb.cone(0.055, 0.1, 8, { z: 0.22, rx: Math.PI / 2 }, { color: 0xc03a2a, mat: 'metal', jitter: 0.05, ao: 0 });
    gb.cyl(0.04, 0.04, 0.03, 8, { z: -0.02, rx: Math.PI / 2 }, { color: 0xff8a2a, mat: 'glow', glow: 2.6 });
    this.grenadeProto = toGroup(gb.build(), { castShadow: false });

    this.bind();
  }

  private bind(): void {
    const { game } = this;
    const e = game.events;
    this.off.push(
      e.on('shot', (s) => this.onShot(s.kind, s.yaw)),
      e.on('impact', (i) => {
        if (i.flesh) {
          this.bloodSpray(i.x, i.z, -i.nx, -i.nz, i.zone === 'head' ? 14 : 7, 1, i.y);
          // 爆头：一团向上散开的血雾
          if (i.zone === 'head') for (let k = 0; k < 6; k++) this.blood(i.x, i.y, i.z, this.rng.range(-1.2, 1.2), this.rng.range(1.5, 3.5), this.rng.range(-1.2, 1.2), 0.12);
        } else if (i.zone === 'ground') this.dirt(i.x, i.z);
        else this.sparks(i.x, i.z, i.nx, i.nz, i.y);
      }),
      e.on('meleeHit', (m) => {
        if (!m.zombie) return;
        this.bloodSpray(m.x, m.z, Math.sin(this.game.player.yaw), Math.cos(this.game.player.yaw), 10, 1, m.y);
        this.rig.addShake(0.22);
      }),
      e.on('zombieHit', (h) => {
        const z = h.zombie;
        // 爆头先用暴击的金色数字顶着，M9 会做专门的样式
        this.text.damage(z.id, z.x, 1.9 * MODEL_SCALE[z.kind], z.z, h.amount, h.crit || h.head);
      }),
      e.on('zombieDied', ({ zombie: z }) => {
        const s = MODEL_SCALE[z.kind];
        this.bloodSpray(z.x, z.z, Math.sin(z.yaw), Math.cos(z.yaw), Math.round(12 * Math.sqrt(s)), s);
        this.decals.add('blood', z.x + this.rng.range(-0.2, 0.2), z.z + this.rng.range(-0.2, 0.2), 1.5 * Math.sqrt(s) + this.rng.range(0, 0.6));
        if (z.kind === 'bloater') return;
        // 少量血雾向上
        for (let i = 0; i < 4; i++) this.blood(z.x, 0.9 * s, z.z, this.rng.range(-1, 1), this.rng.range(2, 5), this.rng.range(-1, 1), 0.07);
      }),
      e.on('scrap', (s) => this.text.scrap(s.x, 1.2, s.z, s.amount)),
      e.on('explosion', (x) => this.onExplosion(x.x, x.z, x.radius, x.big)),
      e.on('acid', (a) => this.onAcid(a.x, a.z, a.radius)),
      e.on('playerDied', (p) => {
        // 第一人称里镜头就在玩家身上，近处的血粒子会变成满屏的大方块，所以只留地上的血迹
        this.decals.add('blood', p.x, p.z, 2.4, 60);
        this.rig.addShake(0.6);
      }),
      // 镜头震动按伤害量算：以前每次掉血都 +0.3，污染区的污水每帧都扣一点血（6 点/秒），
      // 站在上面镜头就一直剧烈抖。现在被咬一口（10–30 点）照样震，持续的小伤害几乎不震
      e.on('playerDamaged', (d) => this.rig.addShake(Math.min(0.3, d.amount * 0.02))),
      e.on('coreDamaged', () => this.rig.addShake(0.08)),
    );
  }

  // ---------------------------------------------------------------- 基础粒子

  private blood(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const k = this.rng.range(0.8, 1.2);
    this.particles.spawn({ x, y, z, vx, vy, vz, size, life: this.rng.range(0.5, 0.95), r: 0.5 * k, g: 0.04 * k, b: 0.035 * k, gravity: 15, drag: 0.6, bounce: 0.25 });
  }

  /** 血液喷溅：沿 (dx,dz) 方向喷出一扇形 */
  private bloodSpray(x: number, z: number, dx: number, dz: number, n: number, scale: number, y?: number): void {
    for (let i = 0; i < n; i++) {
      const sp = this.rng.range(2.5, 6.5);
      this.blood(x, y !== undefined ? y + this.rng.range(-0.08, 0.08) : this.rng.range(0.7, 1.4) * scale, z, dx * sp + this.rng.range(-1.6, 1.6), this.rng.range(0.5, 3.5), dz * sp + this.rng.range(-1.6, 1.6), this.rng.range(0.05, 0.1) * Math.sqrt(scale));
    }
  }

  /** 子弹打在地上：一小股尘土 */
  private dirt(x: number, z: number): void {
    for (let i = 0; i < 5; i++) {
      this.particles.spawn({ x, y: 0.03, z, vx: this.rng.range(-0.8, 0.8), vy: this.rng.range(1.2, 3), vz: this.rng.range(-0.8, 0.8), size: this.rng.range(0.03, 0.06), life: this.rng.range(0.35, 0.6), r: 0.32, g: 0.28, b: 0.22, gravity: 10, drag: 0.6 });
    }
    this.particles.spawn({ x, y: 0.08, z, vx: 0, vy: 0.4, vz: 0, size: 0.16, life: 0.5, r: 0.36, g: 0.33, b: 0.28, gravity: -0.3, drag: 2.5 });
  }

  private sparks(x: number, z: number, nx: number, nz: number, y = 1.1): void {
    for (let i = 0; i < 7; i++) {
      const sp = this.rng.range(2, 6);
      this.particles.spawn({
        x,
        y,
        z,
        vx: nx * sp + this.rng.range(-2, 2),
        vy: this.rng.range(0.5, 3.5),
        vz: nz * sp + this.rng.range(-2, 2),
        size: this.rng.range(0.025, 0.05),
        life: this.rng.range(0.2, 0.45),
        r: 4.2,
        g: 2.4,
        b: 0.9,
        gravity: 9,
        drag: 0.4,
        bounce: 0.35,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.particles.spawn({ x, y, z, vx: nx * 1.2 + this.rng.range(-0.6, 0.6), vy: this.rng.range(0.3, 1.0), vz: nz * 1.2 + this.rng.range(-0.6, 0.6), size: this.rng.range(0.08, 0.14), life: this.rng.range(0.35, 0.6), r: 0.34, g: 0.33, b: 0.3, gravity: -0.5, drag: 2.5 });
    }
  }

  // ---------------------------------------------------------------- 射击

  private onShot(kind: WeaponKind, yaw: number): void {
    // 逻辑层先扣子弹再发事件：这时弹匣为 0 就是打完了最后一发
    this.viewmodel.fire(kind, 1 / this.game.statsOf(kind, this.game.player.tier).rate, this.game.loadout[kind].mag <= 0);
    const m = this.viewmodel.muzzleWorld(this.muzzle, this.rig.camera);
    this.flashT = 0.06;
    this.flashLight.position.copy(m);
    this.flashPeak = FLASH_LIGHT[kind];
    this.rig.addShake(SHAKE[kind]);
    this.rig.kick(KICK[kind]);

    // 抛壳：从枪的右侧弹出。右方 = (-cos yaw, sin yaw)，前方 = (sin yaw, cos yaw)
    if (kind === 'launcher') return;
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const shell = kind === 'shotgun';
    const big = kind === 'sniper' || kind === 'lmg';
    // 弹壳从枪口后方 0.2 米处弹出，但离眼睛至少 0.9 米：TACZ 模型的枪口离镜头只有 0.3–0.4 米，
    // 不往前推的话弹壳贴着镜头飞过去，会糊成一大块色块（程序模型的枪口本来就在 0.8 米左右）
    const cam = this.rig.camera.position;
    const ahead = (m.x - cam.x) * fx + (m.z - cam.z) * fz - 0.2;
    const back = 0.2 - Math.max(0, 0.9 - ahead);
    this.particles.spawn({
      x: m.x - fx * back,
      y: m.y + 0.03,
      z: m.z - fz * back,
      vx: rx * this.rng.range(1.6, 2.6) + fx * 0.3 + this.rng.range(-0.4, 0.4),
      vy: this.rng.range(1.6, 2.6),
      vz: rz * this.rng.range(1.6, 2.6) + fz * 0.3 + this.rng.range(-0.4, 0.4),
      size: shell ? 0.07 : big ? 0.05 : 0.04,
      life: 1.6,
      r: shell ? 0.8 : 1.5,
      g: shell ? 0.12 : 1.1,
      b: shell ? 0.08 : 0.35,
      gravity: 16,
      drag: 0.3,
      shrink: false,
      bounce: 0.4,
    });
  }

  /**
   * 空中的子弹：每颗一道发光的短线，沿真实轨迹飞。
   * 子弹是从眼睛出膛的（保证准星就是落点），为了让曳光看起来从枪口出来，
   * 给它加一个偏移：一开始偏到枪口位置，飞出约 8 米后逐渐归零，汇到准星线上。
   */
  private updateBullets(): void {
    const bullets = this.game.bullets;
    const seen = this.bulletSeen;
    seen.clear();
    let used = 0;
    for (const b of bullets) {
      if (used >= this.bulletMeshes.length) break;
      seen.add(b.id);
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const dx = b.vx / sp;
      const dy = b.vy / sp;
      const dz = b.vz / sp;
      let off = this.bulletOff.get(b.id);
      if (!off) {
        off = new Vector3();
        if (this.rig.mode === 'fps') off.set(this.muzzle.x - (b.x - dx * b.traveled), this.muzzle.y - (b.y - dy * b.traveled), this.muzzle.z - (b.z - dz * b.traveled));
        this.bulletOff.set(b.id, off);
      }
      const f = Math.max(0, 1 - b.traveled / 8);
      // 刚出膛的一小段不画（还在枪口里面）
      if (b.traveled < 0.4) continue;
      const len = Math.min(3, sp * 0.012);
      const m = this.bulletMeshes[used++] as Mesh;
      m.position.set(b.x + off.x * f - dx * len * 0.5, b.y + off.y * f - dy * len * 0.5, b.z + off.z * f - dz * len * 0.5);
      m.lookAt(m.position.x + dx, m.position.y + dy, m.position.z + dz);
      m.scale.set(0.02, 0.02, len);
      m.visible = true;
    }
    for (let i = used; i < this.bulletMeshes.length; i++) (this.bulletMeshes[i] as Mesh).visible = false;
    for (const id of this.bulletOff.keys()) if (!seen.has(id)) this.bulletOff.delete(id);
  }

  /** 画一道曳光（两点之间最后一段）。炮塔用 */
  private drawTracer(a: Vector3, b: Vector3, hitFlesh: boolean): void {
    const t = this.tracers[this.tracerIdx] as Tracer;
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.6) return;
    // 曳光弹只画靠近终点的一段，像一道闪过的光
    const l = Math.min(len, 5 + this.rng.range(0, 2));
    const k = (len - l / 2) / len;
    t.mesh.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    t.mesh.lookAt(b);
    t.mesh.scale.set(hitFlesh ? 0.022 : 0.016, 0.016, l);
    t.mesh.visible = true;
    t.age = 0;
    t.life = 0.07;
  }

  // ---------------------------------------------------------------- 爆炸与酸液

  private onExplosion(x: number, z: number, radius: number, big: boolean): void {
    const fire = new Mesh(new SphereGeometry(1, 14, 10), new MeshBasicMaterial({ color: new Color(3.0, 1.5, 0.45), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    fire.position.set(x, 0.9, z);
    // 内核：更小更亮，很快消退
    const core = new Mesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: new Color(6, 5, 3.2), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    core.position.set(x, 0.9, z);
    fire.add(core);
    core.position.set(0, 0, 0);
    const ring = new Mesh(new RingGeometry(0.93, 1, 48), new MeshBasicMaterial({ color: new Color(1.4, 1.0, 0.6), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: 2 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
    this.scene.add(fire, ring);
    this.booms.push({ fire, ring, age: 0, radius });

    this.boomLight.position.set(x, 1.4, z);
    this.boomT = big ? 0.32 : 0.18;
    this.rig.addShake(big ? 0.55 : 0.18);
    this.decals.add('scorch', x, z, radius * (big ? 2.4 : 1.6), 40);

    const n = big ? 22 : 10;
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(1.5, 6.5) * (radius / 2.2);
      this.particles.spawn({ x, y: 0.5, z, vx: Math.cos(a) * sp, vy: this.rng.range(2, 8), vz: Math.sin(a) * sp, size: this.rng.range(0.1, 0.22), life: this.rng.range(0.3, 0.7), r: 4, g: 1.7, b: 0.4, gravity: 6, drag: 1.2 });
    }
    for (let i = 0; i < (big ? 14 : 5); i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(0.6, 2.8);
      this.particles.spawn({ x: x + Math.cos(a) * 0.4, y: 0.6, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * sp, vy: this.rng.range(1.5, 3.5), vz: Math.sin(a) * sp, size: this.rng.range(0.25, 0.5), life: this.rng.range(0.8, 1.5), r: 0.2, g: 0.19, b: 0.18, gravity: -1.2, drag: 1.8 });
    }
    for (let i = 0; i < (big ? 10 : 3); i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(3, 8);
      this.particles.spawn({ x, y: 0.4, z, vx: Math.cos(a) * sp, vy: this.rng.range(4, 9), vz: Math.sin(a) * sp, size: this.rng.range(0.05, 0.1), life: 1.3, r: 0.22, g: 0.18, b: 0.14, gravity: 18, drag: 0.2, bounce: 0.35, shrink: false });
    }
  }

  private onAcid(x: number, z: number, radius: number): void {
    this.decals.add('acid', x, z, radius * 2.1, 22);
    for (let i = 0; i < 26; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(1.5, 5.5);
      this.particles.spawn({ x, y: 0.8, z, vx: Math.cos(a) * sp, vy: this.rng.range(1.5, 6), vz: Math.sin(a) * sp, size: this.rng.range(0.07, 0.16), life: this.rng.range(0.5, 1.0), r: 0.7, g: 3.0, b: 0.3, gravity: 13, drag: 0.5, bounce: 0.2 });
    }
    this.rig.addShake(0.2);
  }

  // ---------------------------------------------------------------- 建筑相关（供 StructureViews 调用）

  /** 木屑 / 碎片：建筑被打中或被拆毁时 */
  chips(x: number, z: number, color: [number, number, number], n: number, power = 1): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(1.2, 3.6) * power;
      const k = this.rng.range(0.7, 1.2);
      this.particles.spawn({
        x: x + this.rng.range(-0.3, 0.3),
        y: this.rng.range(0.3, 1.0),
        z: z + this.rng.range(-0.3, 0.3),
        vx: Math.cos(a) * sp,
        vy: this.rng.range(1.5, 4.5) * power,
        vz: Math.sin(a) * sp,
        size: this.rng.range(0.04, 0.1),
        life: this.rng.range(0.5, 1.0),
        r: color[0] * k,
        g: color[1] * k,
        b: color[2] * k,
        gravity: 14,
        drag: 0.4,
        bounce: 0.3,
      });
    }
  }

  dust(x: number, z: number, n = 8): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(0.4, 1.6);
      this.particles.spawn({ x, y: 0.15, z, vx: Math.cos(a) * sp, vy: this.rng.range(0.2, 0.9), vz: Math.sin(a) * sp, size: this.rng.range(0.12, 0.22), life: this.rng.range(0.4, 0.8), r: 0.42, g: 0.4, b: 0.36, gravity: -0.3, drag: 2.2 });
    }
  }

  /** 炮塔开火：曳光 + 枪口火星 */
  turretFire(x0: number, z0: number, x1: number, z1: number): void {
    this.drawTracer(this.ta.set(x0, 1.15, z0), this.tb.set(x1, 1.15, z1), true);
    for (let i = 0; i < 3; i++) {
      this.particles.spawn({ x: x0, y: 0.75, z: z0, vx: (x1 - x0) * 0.2 + this.rng.range(-1, 1), vy: this.rng.range(0.3, 1.5), vz: (z1 - z0) * 0.2 + this.rng.range(-1, 1), size: 0.04, life: 0.14, r: 4, g: 2.6, b: 1, gravity: 4, drag: 3 });
    }
  }

  /** 一颗发光小粒子（酸团拖尾、燃烧弹引信、酸池气泡）：color 是 HDR 亮度系数 */
  spark(x: number, y: number, z: number, r: number, g: number, b: number): void {
    this.particles.spawn({ x, y, z, vx: this.rng.range(-0.2, 0.2), vy: this.rng.range(0.1, 0.5), vz: this.rng.range(-0.2, 0.2), size: 0.05, life: 0.3, r, g, b, gravity: -0.5, drag: 2 });
  }

  /** 一缕往上飘的烟（空投信号） */
  smoke(x: number, y: number, z: number): void {
    this.particles.spawn({ x, y, z, vx: this.rng.range(-0.15, 0.15), vy: this.rng.range(1.2, 2), vz: this.rng.range(-0.15, 0.15), size: this.rng.range(0.25, 0.45), life: this.rng.range(1.6, 2.4), r: 1.6, g: 0.45, b: 0.3, gravity: -0.2, drag: 0.4 });
  }

  /** 地面火焰的一舔火苗 */
  flameLick(x: number, z: number): void {
    const hot = this.rng.next();
    this.particles.spawn({ x, y: 0.1, z, vx: this.rng.range(-0.3, 0.3), vy: this.rng.range(0.8, 1.8), vz: this.rng.range(-0.3, 0.3), size: this.rng.range(0.12, 0.26), life: this.rng.range(0.35, 0.6), r: 4 + hot * 3, g: 1.4 + hot * 1.2, b: 0.3, gravity: -1.5, drag: 1.5 });
  }

  /** 喷火塔：一股往前喷的火焰粒子 */
  flame(x0: number, z0: number, x1: number, z1: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < 7; i++) {
      const sp = this.rng.range(5, 8);
      const a = Math.atan2(dz, dx) + this.rng.range(-0.35, 0.35);
      const hot = this.rng.next();
      this.particles.spawn({ x: x0 + (dx / len) * 0.2, y: 0.68, z: z0 + (dz / len) * 0.2, vx: Math.cos(a) * sp, vy: this.rng.range(0.2, 1.2), vz: Math.sin(a) * sp, size: this.rng.range(0.14, 0.3), life: this.rng.range(0.35, 0.6), r: 5 + hot * 3, g: 1.8 + hot * 1.4, b: 0.35, gravity: -2.2, drag: 2.6 });
    }
  }

  /** 迫击炮发射：炮口一团烟和火光（炮弹本身按 projectiles 画） */
  mortarLaunch(x: number, z: number): void {
    for (let i = 0; i < 6; i++) {
      this.particles.spawn({ x, y: 1.3, z, vx: this.rng.range(-0.6, 0.6), vy: this.rng.range(1, 2.4), vz: this.rng.range(-0.6, 0.6), size: this.rng.range(0.18, 0.32), life: this.rng.range(0.5, 0.9), r: 0.5, g: 0.48, b: 0.44, gravity: -0.4, drag: 1.8 });
    }
    this.particles.spawn({ x, y: 1.3, z, vx: 0, vy: 0.5, vz: 0, size: 0.4, life: 0.1, r: 6, g: 3.5, b: 1.2, gravity: 0, drag: 0 });
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    // 枪口火光
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = this.flashPeak * Math.max(0, this.flashT / 0.06);
      if (this.flashT <= 0) this.flashLight.intensity = 0;
    }
    // 爆炸光
    if (this.boomT > 0) {
      this.boomT -= dt;
      this.boomLight.intensity = 320 * Math.max(0, this.boomT / 0.32);
      if (this.boomT <= 0) this.boomLight.intensity = 0;
    }
    // 曳光
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.age += dt;
      if (t.age >= t.life) t.mesh.visible = false;
      else (t.mesh.material as MeshBasicMaterial).opacity = 1 - t.age / t.life;
    }
    this.updateBullets();
    // 爆炸球和冲击环
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i] as Boom;
      b.age += dt;
      const k = b.age / 0.38;
      if (k >= 1) {
        this.scene.remove(b.fire, b.ring);
        const core = b.fire.children[0] as Mesh;
        core.geometry.dispose();
        (core.material as MeshBasicMaterial).dispose();
        b.fire.geometry.dispose();
        b.ring.geometry.dispose();
        (b.fire.material as MeshBasicMaterial).dispose();
        (b.ring.material as MeshBasicMaterial).dispose();
        this.booms.splice(i, 1);
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      // 火球：颜色从白黄过渡到暗红，边扩张边变淡
      const m = b.fire.material as MeshBasicMaterial;
      b.fire.scale.setScalar(b.radius * (0.2 + 0.6 * e));
      m.opacity = Math.max(0, 1 - k * 1.15) * 0.55;
      m.color.setRGB(3.0 - 2.2 * k, 1.5 - 1.2 * k, 0.45 - 0.35 * k);
      const core = b.fire.children[0] as Mesh;
      core.scale.setScalar(0.55 * (1 - k));
      (core.material as MeshBasicMaterial).opacity = Math.max(0, 1 - k * 2.2);
      b.ring.scale.setScalar(b.radius * (0.25 + 1.35 * e));
      (b.ring.material as MeshBasicMaterial).opacity = (1 - k) * 0.5;
    }

    // 飞行中的榴弹
    const seen = new Set<Projectile>();
    for (const p of this.game.projectiles) {
      seen.add(p);
      let g = this.grenades.get(p);
      if (!g) {
        g = this.grenadeProto.clone();
        this.scene.add(g);
        this.grenades.set(p, g);
      }
      g.position.set(p.x, p.y, p.z);
      g.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      // 拖尾
      this.particles.spawn({ x: p.x - p.vx * 0.02, y: p.y - p.vy * 0.02, z: p.z - p.vz * 0.02, vx: this.rng.range(-0.3, 0.3), vy: this.rng.range(0, 0.6), vz: this.rng.range(-0.3, 0.3), size: p.bomblet ? 0.06 : 0.1, life: 0.35, r: 2.6, g: 1.2, b: 0.35, gravity: -1, drag: 2 });
    }
    for (const [p, g] of this.grenades) {
      if (!seen.has(p)) {
        this.scene.remove(g);
        this.grenades.delete(p);
      }
    }

    // 燃烧中的僵尸冒火
    for (const z of this.game.zombies) {
      if (!z.alive || z.burnT <= 0 || this.rng.next() > 0.7) continue;
      const s = MODEL_SCALE[z.kind];
      this.particles.spawn({
        x: z.x + this.rng.range(-0.2, 0.2) * s,
        y: this.rng.range(0.3, 1.5) * s,
        z: z.z + this.rng.range(-0.2, 0.2) * s,
        vx: this.rng.range(-0.3, 0.3),
        vy: this.rng.range(1.2, 2.6),
        vz: this.rng.range(-0.3, 0.3),
        size: this.rng.range(0.08, 0.16),
        life: this.rng.range(0.3, 0.55),
        r: 3.6,
        g: 1.3,
        b: 0.25,
        gravity: -3,
        drag: 1.5,
      });
    }

    this.particles.update(dt);
    this.decals.update(dt);
    this.text.update(dt);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.text.dispose();
  }
}
