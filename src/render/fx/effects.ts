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
import type { Zombie } from '../../game/entities/zombie';
import type { Game } from '../../game/sim';
import { headCenter, hitScale } from '../../game/systems/hitvolume';
import { HALF_H, HALF_W } from '../../game/world/grid';
import { surfaceAt } from '../../game/world/surface';
import type { CameraRig } from '../core/cameraRig';
import { Builder, toGroup } from '../kit';
import type { ViewModel } from '../weapons/viewmodel';
import { Decals } from './decals';
import { FloatingText } from './floatingText';
import { Particles } from './particles';
import { Puffs } from './puffs';

const SHAKE: Record<WeaponKind, number> = { pistol: 0.07, smg: 0.05, shotgun: 0.26, rifle: 0.09, sniper: 0.3, lmg: 0.08 };
/** 枪口火光照亮前方世界的点光源峰值 */
const FLASH_LIGHT: Record<WeaponKind, number> = { pistol: 16, smg: 14, shotgun: 46, rifle: 20, sniper: 40, lmg: 24 };

/**
 * 开枪时相机额外的一下"顿挫"（弧度，很快回弹，只影响画面）。
 * 真正的后坐力在逻辑层（player.kickPitch），会实际抬高弹着点。
 */
const KICK: Record<WeaponKind, number> = { pistol: 0.006, smg: 0.003, shotgun: 0.022, rifle: 0.006, sniper: 0.03, lmg: 0.004 };

/** 子弹打在东西上溅出来的量：霰弹一发 10 颗弹丸，每颗少溅一点；狙击多一点 */
const IMPACT_SCALE: Partial<Record<WeaponKind, number>> = { shotgun: 0.5, sniper: 1.6 };
/** 碎屑、灰的大小上限 = 离镜头的距离 × 这个数：贴着墙开枪时不会是一堆大方块糊在眼前 */
const IMPACT_CAP = 0.07;

const _head = { x: 0, y: 0, z: 0 };
const _face = { x: 0, z: 0, nx: 0, nz: 0 };
/** 血粒子的大小上限 = 离镜头的距离 × 这个数（6 米外的不受影响；近处打的时候是一片细血点，不会糊成满屏的红方块） */
const BLOOD_CAP = 0.014;
/** 僵尸的个头（相对 1.6 米高的行尸）：血、火的粒子按它铺开。爬行者 0.44，巨像 2.2，精英再大一圈 */
const bodyScale = (z: Zombie): number => (z.def.height * hitScale(z)) / 1.6;

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
  readonly puffs = new Puffs();
  readonly decals = new Decals();
  readonly text: FloatingText;
  /** 0 黄昏 → 1 夜（View 每帧写进来）：不受光照的碎屑、灰夜里要跟着暗下来，不然像在发光 */
  night = 0;

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
    scene.add(this.puffs.mesh);
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
        } else this.onImpact(i.x, i.y, i.z, i.nx, i.nz, i.zone === 'ground', i.kind);
      }),
      e.on('meleeHit', (m) => {
        if (!m.zombie) return;
        this.bloodSpray(m.x, m.z, Math.sin(this.game.player.yaw), Math.cos(this.game.player.yaw), 10, 1, m.y);
        this.rig.addShake(0.22);
      }),
      e.on('zombieHit', (h) => {
        const z = h.zombie;
        // 数字从头顶冒出来：头的位置跟着姿势走，和命中判定用的是同一个点
        headCenter(z, _head);
        this.text.damage(z.id, _head.x, _head.y + z.def.head.r * hitScale(z) + 0.2, _head.z, h.amount, h.crit, h.head);
      }),
      e.on('zombieDied', ({ zombie: z, head }) => {
        const s = bodyScale(z);
        this.bloodSpray(z.x, z.z, Math.sin(z.yaw), Math.cos(z.yaw), Math.round(12 * Math.sqrt(s)), s);
        this.decals.add('blood', z.x + this.rng.range(-0.2, 0.2), z.z + this.rng.range(-0.2, 0.2), 1.5 * Math.sqrt(s) + this.rng.range(0, 0.6));
        if (head) this.headBurst(z);
        if (z.kind === 'bloater') return;
        // 少量血雾向上
        for (let i = 0; i < 4; i++) this.blood(z.x, 0.9 * s, z.z, this.rng.range(-1, 1), this.rng.range(2, 5), this.rng.range(-1, 1), 0.07);
      }),
      e.on('scrap', (s) => this.text.scrap(s.x, 1.2, s.z, s.amount)),
      e.on('explosion', (x) => this.onExplosion(x.x, x.z, x.radius, x.big)),
      e.on('acid', (a) => this.onAcid(a.x, a.z, a.radius)),
      e.on('gas', (a) => {
        if (!a.ignite) this.onGas(a.x, a.z, a.radius);
      }),
      e.on('split', (s) => {
        // 裂开：血往四周喷、地上一大滩
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
          this.bloodSpray(s.x, s.z, Math.sin(a), Math.cos(a), 7, 1);
        }
        this.decals.add('blood', s.x, s.z, 2.4 + this.rng.range(0, 0.6));
      }),
      e.on('leap', (l) => {
        if (l.stage === 'land') this.dust(l.zombie.x, l.zombie.z, 5);
      }),
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
    this.particles.spawn({ x, y, z, vx, vy, vz, size, life: this.rng.range(0.5, 0.95), r: 0.27 * k, g: 0.014 * k, b: 0.014 * k, gravity: 15, drag: 0.6, bounce: 0.25, cap: BLOOD_CAP });
  }

  /** 血液喷溅：沿 (dx,dz) 方向喷出一扇形 */
  private bloodSpray(x: number, z: number, dx: number, dz: number, n: number, scale: number, y?: number): void {
    for (let i = 0; i < n; i++) {
      const sp = this.rng.range(2.5, 6.5);
      this.blood(x, y !== undefined ? y + this.rng.range(-0.08, 0.08) : this.rng.range(0.7, 1.4) * scale, z, dx * sp + this.rng.range(-1.6, 1.6), this.rng.range(0.5, 3.5), dz * sp + this.rng.range(-1.6, 1.6), this.rng.range(0.05, 0.1) * Math.sqrt(scale));
    }
  }

  /**
   * 爆头击杀：头炸开（模型那边同时换成去掉头的几何体）。血往四周喷，碎块落地会弹，一团细的血雾在原地散开。
   * 位置用头部命中球的球心，大小跟着头的大小走（巨像的头是行尸的两倍）
   */
  private headBurst(z: Zombie): void {
    headCenter(z, _head);
    const { x, y } = _head;
    const hz = _head.z;
    const k = Math.sqrt((z.def.head.r * hitScale(z)) / 0.19);
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(1, 4.5) * k;
      this.blood(x, y, hz, Math.cos(a) * sp, this.rng.range(1, 5.5), Math.sin(a) * sp, this.rng.range(0.045, 0.09) * k);
    }
    for (let i = 0; i < 6; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(1.5, 4) * k;
      const c = this.rng.range(0.7, 1.1);
      this.particles.spawn({ x, y, z: hz, vx: Math.cos(a) * sp, vy: this.rng.range(2, 5), vz: Math.sin(a) * sp, size: this.rng.range(0.06, 0.11) * k, life: this.rng.range(0.9, 1.4), r: 0.17 * c, g: 0.02 * c, b: 0.018 * c, gravity: 16, drag: 0.3, bounce: 0.35, shrink: false, cap: BLOOD_CAP });
    }
    // 血雾：一团很细的血点，阻力大、几乎不往下掉，在原地散开（粒子是不透明的小方块，大块的看着像红砖）
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(0.4, 2.6) * k;
      this.particles.spawn({ x, y: y + this.rng.range(-0.05, 0.08) * k, z: hz, vx: Math.cos(a) * sp, vy: this.rng.range(-0.6, 2.6), vz: Math.sin(a) * sp, size: this.rng.range(0.022, 0.042) * k, life: this.rng.range(0.3, 0.6), r: 0.24, g: 0.012, b: 0.012, gravity: 2.5, drag: 4.5, cap: BLOOD_CAP });
    }
  }

  /** 爆头击杀后，脖子的断口往外冒血（Actors 按断口当前的位置逐帧调用） */
  neckSpurt(x: number, y: number, z: number): void {
    this.blood(x, y, z, this.rng.range(-0.9, 0.9), this.rng.range(1.2, 3.2), this.rng.range(-0.9, 0.9), this.rng.range(0.05, 0.09));
  }

  // ---------------------------------------------------------------- 子弹打在东西上

  /**
   * 子弹打在地上 / 障碍物上，按材质溅东西：铁冒火星，混凝土和砖崩碎渣带一团灰，木头（路障、木箱、树）掉木屑，
   * 土地扬土，沙袋漏沙，水面溅水花。(nx, nz) 是子弹来的方向（水平）
   */
  private onImpact(x: number, y: number, z: number, nx: number, nz: number, ground: boolean, kind: WeaponKind): void {
    const surf = surfaceAt(this.game, x, y, z, ground);
    const k = IMPACT_SCALE[kind] ?? 1;
    const n = (c: number): number => Math.max(1, Math.round(c * k));
    let ux = nx;
    let uy = 0;
    let uz = nz;
    if (ground || surf === 'water') {
      // 地面：往上溅，顺着子弹飞的方向带一点
      ux = -nx * 0.25;
      uy = 1;
      uz = -nz * 0.25;
      y = 0.04;
    } else {
      this.toFace(x, z, nx, nz);
      x = _face.x;
      z = _face.z;
      ux = _face.nx;
      uz = _face.nz;
    }
    switch (surf) {
      case 'metal':
        this.sparks(x, y, z, ux, uy, uz, n(7));
        this.puff(x, y, z, ux, uy, uz, 1, 0.09, 0.09, 0.09, 0.08, 0.3);
        break;
      case 'concrete':
        this.debris(x, y, z, ux, uy, uz, n(5), 0.17, 0.16, 0.145, 0.05, 4.5);
        this.puff(x, y, z, ux, uy, uz, n(3), 0.17, 0.165, 0.15, 0.13, 0.5);
        if (this.rng.chance(0.3)) this.sparks(x, y, z, ux, uy, uz, 2);
        break;
      case 'brick':
        this.debris(x, y, z, ux, uy, uz, n(5), 0.17, 0.05, 0.03, 0.05, 4.5);
        this.puff(x, y, z, ux, uy, uz, n(3), 0.19, 0.1, 0.07, 0.13, 0.5);
        break;
      case 'wood':
        this.debris(x, y, z, ux, uy, uz, n(7), 0.22, 0.12, 0.05, 0.045, 4);
        this.puff(x, y, z, ux, uy, uz, 1, 0.16, 0.12, 0.075, 0.09, 0.3);
        break;
      case 'dirt':
        this.debris(x, y, z, ux, uy, uz, n(5), 0.09, 0.06, 0.035, 0.06, 3, 0);
        this.puff(x, y, z, ux, uy, uz, n(2), 0.13, 0.1, 0.065, 0.13, 0.45);
        break;
      case 'sand':
        this.debris(x, y, z, ux, uy, uz, n(6), 0.28, 0.22, 0.12, 0.035, 3, 0);
        this.puff(x, y, z, ux, uy, uz, n(3), 0.24, 0.2, 0.13, 0.13, 0.5);
        break;
      case 'water':
        this.debris(x, y, z, ux, uy, uz, n(8), 0.34, 0.44, 0.5, 0.045, 4.5, 0);
        this.puff(x, y, z, ux, uy, uz, n(2), 0.3, 0.36, 0.4, 0.1, 0.35);
        break;
    }
  }

  /**
   * 命中判定每 0.2 米采样一次，报上来的点在障碍物里面一点：沿子弹来的方向退回到这一格的边上（墙面就在格子边上），
   * 顺便得到这一面朝哪。细柱子、栅栏、玩家造的建筑不占满整格，不动
   */
  private toFace(x: number, z: number, nx: number, nz: number): void {
    _face.x = x;
    _face.z = z;
    _face.nx = nx;
    _face.nz = nz;
    const grid = this.game.grid;
    const cx = grid.cellX(x);
    const cy = grid.cellY(z);
    if (!grid.inBounds(cx, cy)) return;
    const i = grid.idx(cx, cy);
    if (!grid.solid[i] || (grid.post[i] as number) > 0 || grid.slab[i]) return;
    const sx = nx > 1e-3 ? (cx + 1 - HALF_W - x) / nx : nx < -1e-3 ? (cx - HALF_W - x) / nx : 9;
    const sz = nz > 1e-3 ? (cy + 1 - HALF_H - z) / nz : nz < -1e-3 ? (cy - HALF_H - z) / nz : 9;
    const s = Math.min(sx, sz);
    const ax = sx < sz ? Math.sign(nx) : 0;
    const az = sx < sz ? 0 : Math.sign(nz);
    // 退得太远、或者那一侧也是实心的：子弹是擦着墙角 / 从上面打进来的，还用原来的点
    if (s > 0.5 || grid.isStaticSolid(cx + ax, cy + az)) return;
    _face.x = x + nx * s;
    _face.z = z + nz * s;
    _face.nx = ax * 0.75 + nx * 0.25;
    _face.nz = az * 0.75 + nz * 0.25;
  }

  /** 一把碎屑：顺着 (ux, uy, uz) 往外崩，受重力往下掉；bounce > 0 的落地会弹（石渣、木屑），土和水不弹 */
  private debris(x: number, y: number, z: number, ux: number, uy: number, uz: number, n: number, r: number, g: number, b: number, size: number, speed: number, bounce = 0.3): void {
    for (let i = 0; i < n; i++) {
      const sp = this.rng.range(0.35, 1) * speed;
      const c = this.rng.range(0.75, 1.15) * this.dim();
      this.particles.spawn({ x, y, z, vx: ux * sp + this.rng.range(-1.3, 1.3), vy: uy * sp + this.rng.range(0.3, 2.4), vz: uz * sp + this.rng.range(-1.3, 1.3), size: this.rng.range(0.5, 1) * size, life: this.rng.range(0.4, 0.8), r: r * c, g: g * c, b: b * c, gravity: 12, drag: 0.5, bounce, cap: IMPACT_CAP });
    }
  }

  /** 一团灰：软边的半透明圆片，从命中点顺着 (ux, uy, uz) 冒出来，边散开边变淡。alpha = 最浓时的不透明度 */
  private puff(x: number, y: number, z: number, ux: number, uy: number, uz: number, n: number, r: number, g: number, b: number, size: number, alpha: number): void {
    const c = this.dim();
    for (let i = 0; i < n; i++) {
      const sp = this.rng.range(0.4, 1.5);
      const k = c * this.rng.range(0.85, 1.1);
      this.puffs.spawn({ x, y, z, vx: ux * sp + this.rng.range(-0.35, 0.35), vy: uy * sp + this.rng.range(0.1, 0.6), vz: uz * sp + this.rng.range(-0.35, 0.35), size: this.rng.range(0.7, 1.1) * size, grow: this.rng.range(2.6, 3.8), life: this.rng.range(0.4, 0.7), r: r * k, g: g * k, b: b * k, alpha });
    }
  }

  /** 碎屑和灰不受光照：夜里按这个系数压暗，不然在黑夜里像在发光 */
  private dim(): number {
    return 1 - 0.75 * this.night;
  }

  private sparks(x: number, y: number, z: number, ux: number, uy: number, uz: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const sp = this.rng.range(2, 6);
      this.particles.spawn({ x, y, z, vx: ux * sp + this.rng.range(-2, 2), vy: uy * sp + this.rng.range(0.5, 3.5), vz: uz * sp + this.rng.range(-2, 2), size: this.rng.range(0.025, 0.05), life: this.rng.range(0.2, 0.45), r: 4.2, g: 2.4, b: 0.9, gravity: 9, drag: 0.4, bounce: 0.35, cap: IMPACT_CAP });
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
    const dim = 1 - 0.5 * this.night;
    this.particles.spawn({
      x: m.x - fx * back,
      y: m.y + 0.03,
      z: m.z - fz * back,
      vx: rx * this.rng.range(1.6, 2.6) + fx * 0.3 + this.rng.range(-0.4, 0.4),
      vy: this.rng.range(1.6, 2.6),
      vz: rz * this.rng.range(1.6, 2.6) + fz * 0.3 + this.rng.range(-0.4, 0.4),
      size: shell ? 0.026 : big ? 0.02 : 0.016,
      life: 1.6,
      r: (shell ? 0.3 : 0.4) * dim,
      g: (shell ? 0.04 : 0.27) * dim,
      b: (shell ? 0.03 : 0.08) * dim,
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
    const dim = this.dim();
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(1.5, 6.5) * (radius / 2.2);
      this.particles.spawn({ x, y: 0.5, z, vx: Math.cos(a) * sp, vy: this.rng.range(2, 8), vz: Math.sin(a) * sp, size: this.rng.range(0.1, 0.22), life: this.rng.range(0.3, 0.7), r: 4, g: 1.7, b: 0.4, gravity: 6, drag: 1.2 });
    }
    for (let i = 0; i < (big ? 16 : 8); i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(0.6, 2.8);
      const c = this.dim() * this.rng.range(0.8, 1.1);
      this.puffs.spawn({ x: x + Math.cos(a) * 0.4, y: 0.6, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * sp, vy: this.rng.range(1.5, 3.5), vz: Math.sin(a) * sp, size: this.rng.range(0.45, 0.8), grow: this.rng.range(2, 2.8), life: this.rng.range(1.2, 2.2), r: 0.032 * c, g: 0.03 * c, b: 0.028 * c, alpha: 0.9, rise: 1.2, drag: 1.8 });
    }
    for (let i = 0; i < (big ? 10 : 3); i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(3, 8);
      this.particles.spawn({ x, y: 0.4, z, vx: Math.cos(a) * sp, vy: this.rng.range(4, 9), vz: Math.sin(a) * sp, size: this.rng.range(0.05, 0.1), life: 1.3, r: 0.1 * dim, g: 0.08 * dim, b: 0.06 * dim, gravity: 18, drag: 0.2, bounce: 0.35, shrink: false });
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

  /** 毒雾者死后喷出一团毒雾：地上留一片黄绿的污渍，一圈烟往外扩 */
  private onGas(x: number, z: number, radius: number): void {
    this.decals.add('acid', x, z, radius * 1.3, 14);
    const c = this.dim();
    for (let i = 0; i < 18; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(0.8, 2.4) * (radius / 2.8);
      this.puffs.spawn({ x, y: this.rng.range(0.3, 1.2), z, vx: Math.cos(a) * sp, vy: this.rng.range(0, 0.5), vz: Math.sin(a) * sp, size: this.rng.range(0.4, 0.7), grow: 2.4, life: this.rng.range(1.2, 2), r: 0.12 * c, g: 0.15 * c, b: 0.055 * c, alpha: 0.5, rise: 0.15, drag: 1.4 });
    }
  }

  /** 一缕毒气（毒雾者身边和地上的毒雾里不停冒） */
  gas(x: number, y: number, z: number, big: boolean): void {
    const c = this.dim();
    this.puffs.spawn({ x, y, z, vx: this.rng.range(-0.2, 0.2), vy: this.rng.range(0.05, 0.3), vz: this.rng.range(-0.2, 0.2), size: big ? this.rng.range(0.45, 0.75) : this.rng.range(0.2, 0.35), grow: 2.2, life: this.rng.range(1.2, 2), r: 0.12 * c, g: 0.15 * c, b: 0.055 * c, alpha: big ? 0.32 : 0.28, rise: 0.15, drag: 1.2 });
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
    const c = this.dim();
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, 6.28);
      const sp = this.rng.range(0.4, 1.6);
      this.puffs.spawn({ x, y: 0.15, z, vx: Math.cos(a) * sp, vy: this.rng.range(0.2, 0.9), vz: Math.sin(a) * sp, size: this.rng.range(0.22, 0.36), grow: 2.6, life: this.rng.range(0.6, 1.1), r: 0.17 * c, g: 0.16 * c, b: 0.145 * c, alpha: 0.45, rise: 0.3, drag: 2.2 });
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
      const s = bodyScale(z);
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

    this.particles.eye.copy(this.rig.camera.position);
    this.particles.update(dt);
    this.puffs.eye.copy(this.rig.camera.position);
    this.puffs.update(dt);
    this.decals.update(dt);
    this.text.update(dt);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.text.dispose();
    this.puffs.dispose();
  }
}
