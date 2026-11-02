import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { Rng } from '../../game/core/rng';
import type { WeaponKind } from '../../game/data/weapons';
import type { Projectile } from '../../game/entities/projectile';
import type { Game } from '../../game/sim';
import type { Actors } from '../actors';
import type { CameraRig } from '../cameraRig';
import { Builder, toGroup } from '../kit';
import { MODEL_SCALE } from '../models/zombies';
import { Decals } from './decals';
import { FloatingText } from './floatingText';
import { Particles } from './particles';

const SHAKE: Record<WeaponKind, number> = { pistol: 0.07, smg: 0.05, shotgun: 0.26, rifle: 0.09, launcher: 0.34 };
const FLASH_LIGHT: Record<WeaponKind, number> = { pistol: 45, smg: 40, shotgun: 130, rifle: 55, launcher: 150 };

function flashTexture(): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,220,150,0.85)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // 十字星芒
  ctx.fillStyle = 'rgba(255,240,200,0.9)';
  ctx.fillRect(S / 2 - 3, 8, 6, S - 16);
  ctx.fillRect(8, S / 2 - 3, S - 16, 6);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

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
  private readonly flash = new Group();
  private readonly flashLight = new PointLight(0xffa860, 0, 9, 2);
  private flashT = 0;
  private flashPeak = 0;
  private readonly boomLight = new PointLight(0xff8a3a, 0, 16, 2);
  private boomT = 0;
  private readonly tracers: Tracer[] = [];
  private tracerIdx = 0;
  private readonly booms: Boom[] = [];
  private readonly grenades = new Map<Projectile, Group>();
  private readonly grenadeProto: Group;
  private readonly v = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
    private readonly rig: CameraRig,
    private readonly actors: Actors,
    container: HTMLElement,
    camera: PerspectiveCamera,
    size: () => { w: number; h: number },
  ) {
    this.text = new FloatingText(container, camera, size);
    scene.add(this.particles.mesh);
    scene.add(this.decals.group);

    // 枪口火光：两张交叉的发光面片 + 一盏短命点光源
    const tex = flashTexture();
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: new Color(2.4, 1.7, 1.0) });
    const quad = new PlaneGeometry(0.7, 0.42);
    const a = new Mesh(quad, mat);
    a.position.z = 0.3;
    const b = new Mesh(quad, mat);
    b.position.z = 0.3;
    b.rotation.z = Math.PI / 2;
    const c = new Mesh(new PlaneGeometry(0.5, 0.5), mat);
    c.position.z = 0.05;
    this.flash.add(a, b, c);
    this.flash.visible = false;
    scene.add(this.flash);
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
      e.on('tracer', (t) => this.onTracer(t.x0, t.z0, t.x1, t.z1, t.hitFlesh)),
      e.on('impact', (i) => (i.flesh ? this.bloodSpray(i.x, i.z, -i.nx, -i.nz, 7, 1) : this.sparks(i.x, i.z, i.nx, i.nz))),
      e.on('zombieHit', (h) => {
        const z = h.zombie;
        this.text.damage(z.id, z.x, 1.9 * MODEL_SCALE[z.kind], z.z, h.amount, h.crit);
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
      e.on('playerDamaged', () => this.rig.addShake(0.3)),
      e.on('coreDamaged', () => this.rig.addShake(0.08)),
    );
  }

  // ---------------------------------------------------------------- 基础粒子

  private blood(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const k = this.rng.range(0.8, 1.2);
    this.particles.spawn({ x, y, z, vx, vy, vz, size, life: this.rng.range(0.5, 0.95), r: 0.5 * k, g: 0.04 * k, b: 0.035 * k, gravity: 15, drag: 0.6, bounce: 0.25 });
  }

  /** 血液喷溅：沿 (dx,dz) 方向喷出一扇形 */
  private bloodSpray(x: number, z: number, dx: number, dz: number, n: number, scale: number): void {
    for (let i = 0; i < n; i++) {
      const sp = this.rng.range(2.5, 6.5);
      this.blood(x, this.rng.range(0.7, 1.4) * scale, z, dx * sp + this.rng.range(-1.6, 1.6), this.rng.range(0.5, 3.5), dz * sp + this.rng.range(-1.6, 1.6), this.rng.range(0.05, 0.1) * Math.sqrt(scale));
    }
  }

  private sparks(x: number, z: number, nx: number, nz: number): void {
    for (let i = 0; i < 7; i++) {
      const sp = this.rng.range(2, 6);
      this.particles.spawn({
        x,
        y: 1.1,
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
      this.particles.spawn({ x, y: 1.1, z, vx: nx * 1.2 + this.rng.range(-0.6, 0.6), vy: this.rng.range(0.3, 1.0), vz: nz * 1.2 + this.rng.range(-0.6, 0.6), size: this.rng.range(0.08, 0.14), life: this.rng.range(0.35, 0.6), r: 0.34, g: 0.33, b: 0.3, gravity: -0.5, drag: 2.5 });
    }
  }

  // ---------------------------------------------------------------- 射击

  private onShot(kind: WeaponKind, yaw: number): void {
    this.actors.player.muzzleWorld(this.v);
    this.flash.position.copy(this.v);
    this.flash.rotation.y = yaw;
    const s = (kind === 'shotgun' ? 1.5 : kind === 'launcher' ? 1.7 : kind === 'pistol' ? 0.85 : 1) * this.rng.range(0.85, 1.15);
    this.flash.scale.setScalar(s);
    this.flash.rotation.z = this.rng.range(0, 6.28);
    this.flash.visible = true;
    this.flashT = 0.06;
    this.flashLight.position.copy(this.v);
    this.flashPeak = FLASH_LIGHT[kind];
    this.rig.addShake(SHAKE[kind]);

    // 抛壳：向枪的右侧弹出
    if (kind === 'launcher') return;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const shell = kind === 'shotgun';
    this.particles.spawn({
      x: this.v.x - Math.sin(yaw) * 0.35,
      y: 1.2,
      z: this.v.z - Math.cos(yaw) * 0.35,
      vx: rx * this.rng.range(2, 3.5) + this.rng.range(-0.5, 0.5),
      vy: this.rng.range(2.5, 4),
      vz: rz * this.rng.range(2, 3.5) + this.rng.range(-0.5, 0.5),
      size: shell ? 0.07 : 0.04,
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

  private onTracer(x0: number, z0: number, x1: number, z1: number, hitFlesh: boolean): void {
    const t = this.tracers[this.tracerIdx] as Tracer;
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    // 曳光弹只画中间一段，从枪口前一点到命中点，像一道闪过的光
    const head = len;
    const tail = Math.max(0, len - Math.min(len, 5 + this.rng.range(0, 2)));
    const l = head - tail;
    const mx = x0 + (dx / len) * (tail + l / 2);
    const mz = z0 + (dz / len) * (tail + l / 2);
    t.mesh.position.set(mx, 1.15, mz);
    t.mesh.rotation.y = Math.atan2(dx, dz);
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
    this.onTracer(x0, z0, x1, z1, true);
    for (let i = 0; i < 3; i++) {
      this.particles.spawn({ x: x0, y: 0.75, z: z0, vx: (x1 - x0) * 0.2 + this.rng.range(-1, 1), vy: this.rng.range(0.3, 1.5), vz: (z1 - z0) * 0.2 + this.rng.range(-1, 1), size: 0.04, life: 0.14, r: 4, g: 2.6, b: 1, gravity: 4, drag: 3 });
    }
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    // 枪口火光
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = this.flashPeak * Math.max(0, this.flashT / 0.06);
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
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
      g.position.set(p.x, 1.2, p.z);
      g.rotation.y = Math.atan2(p.vx, p.vz);
      // 拖尾
      this.particles.spawn({ x: p.x - p.vx * 0.02, y: 1.2, z: p.z - p.vz * 0.02, vx: this.rng.range(-0.3, 0.3), vy: this.rng.range(0, 0.6), vz: this.rng.range(-0.3, 0.3), size: p.bomblet ? 0.06 : 0.1, life: 0.35, r: 2.6, g: 1.2, b: 0.35, gravity: -1, drag: 2 });
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
