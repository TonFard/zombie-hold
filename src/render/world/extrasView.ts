import { AdditiveBlending, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RingGeometry, Scene, SphereGeometry, SpotLight, Sprite, SpriteMaterial } from 'three';
import { Rng } from '../../game/core/rng';
import { FLASHLIGHT, nightMod } from '../../game/data/modifiers';
import type { Game } from '../../game/sim';
import type { CameraRig } from '../core/cameraRig';
import type { Lighting } from '../core/lighting';
import type { Effects } from '../fx/effects';
import { Builder, toGroup } from '../kit';

/**
 * M12 玩法的画面：炸掉的爆炸物（盖一个焦黑残骸）、地面火焰 / 酸池、飞行中的手雷和酸团、
 * 电击脉冲的充能圈和放电环、尖叫波纹、手电筒聚光灯、浓雾 / 停电词缀。
 */
export class ExtrasView {
  private readonly off: Array<() => void> = [];
  private readonly rng = new Rng(4242);
  private readonly wrecks = new Group();
  private readonly flash: SpotLight;
  private readonly flashTarget = new Object3D();
  private readonly grenadeMeshes: Mesh[] = [];
  private readonly spitMeshes: Mesh[] = [];
  private readonly grenadeGeo = new SphereGeometry(0.07, 8, 6);
  private readonly grenadeMat = new MeshStandardMaterial({ color: 0x3a4430, roughness: 0.6, metalness: 0.4 });
  private readonly spitGeo = new SphereGeometry(0.12, 8, 6);
  private readonly spitMat = new MeshBasicMaterial({ color: 0x9aff3a, toneMapped: false });
  private readonly rings: Array<{ mesh: Mesh; age: number; life: number; r0: number; r1: number }> = [];
  private readonly chargeRing: Mesh;
  private time = 0;
  private emberT = 0;
  /** 空投：箱子 + 信号烟柱 + 发光的信号灯（不用真实光源：每多一盏灯所有材质都要多算一遍） */
  private readonly drop = new Group();
  private readonly smoke: Array<{ sp: Sprite; mat: SpriteMaterial; age: number; life: number; vx: number; vz: number; s0: number }> = [];
  private smokeIdx = 0;
  private smokeT = 0;
  /** 首领冲锋预警红线、弱点光球（每个首领一份） */
  private readonly warn = new Map<number, Mesh>();
  private readonly cores = new Map<number, Mesh>();
  private readonly warnGeo = new PlaneGeometry(1, 1);
  private readonly coreGeo = new SphereGeometry(1, 14, 10);

  constructor(
    private readonly scene: Scene,
    private readonly game: Game,
    private readonly fx: Effects,
    private readonly rig: CameraRig,
    private readonly lighting: Lighting,
  ) {
    scene.add(this.wrecks);
    // 手电筒：挂在相机上的聚光灯（不投影，省性能）
    // 衰减 1（以前 1.4）：贴着墙不再一片死白（实测亮度 11 → 195），10 米外的路面也照得清
    this.flash = new SpotLight(0xfff2d8, 0, FLASHLIGHT.range, 0.4, 0.5, 1);
    this.flash.castShadow = false;
    this.flash.target = this.flashTarget;
    scene.add(this.flash, this.flashTarget);

    this.chargeRing = new Mesh(new RingGeometry(0.97, 1, 64), new MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: AdditiveBlending, side: 2 }));
    this.chargeRing.rotation.x = -Math.PI / 2;
    this.chargeRing.position.y = 0.06;
    this.chargeRing.visible = false;
    scene.add(this.chargeRing);

    this.drop.add(toGroup(airdropModel().build()));
    this.drop.visible = false;
    scene.add(this.drop);
    // 信号烟：柔边的烟团贴图，正常混合（不发光），升起时变大变淡、被风吹偏
    const tex = smokeTexture();
    for (let i = 0; i < SMOKE_N; i++) {
      const mat = new SpriteMaterial({ map: tex, color: 0xd8584a, transparent: true, opacity: 0, depthWrite: false });
      const sp = new Sprite(mat);
      sp.visible = false;
      scene.add(sp);
      this.smoke.push({ sp, mat, age: 0, life: 1, vx: 0, vz: 0, s0: 0.3 });
    }

    // 冒烟的车（M19）：地图里的车每 4 辆挑一辆，再隔一辆着火（固定，不随机）
    const cars = game.map.props.filter((p) => p.kind === 'car');
    cars.forEach((c, k) => {
      if (k % 4 !== 1) return;
      this.smokers.push({ x: (c.x0 + c.x1) / 2 - game.map.grid.w / 2, z: (c.y0 + c.y1) / 2 - game.map.grid.h / 2, fire: k % 8 === 1 });
    });

    const e = game.events;
    this.off.push(
      e.on('riskFlare', (f) => {
        this.flare = f.on ? { x: f.x, z: f.z } : null;
        if (f.on) this.ring(f.x, f.z, 0.4, 3, 1, 0xff4a3a);
      }),
      e.on('airdrop', (a) => {
        this.drop.visible = a.stage === 'land';
        this.drop.position.set(a.x, 0, a.z);
        if (a.stage === 'land') this.ring(a.x, a.z, 0.5, 4, 1, 0xff6a3a);
      }),
      e.on('bossCharge', (c) => {
        if (c.stage === 'windup') {
          let m = this.warn.get(c.id);
          if (!m) {
            m = new Mesh(this.warnGeo, new MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, blending: AdditiveBlending, side: 2 }));
            m.rotation.order = 'YXZ';
            this.scene.add(m);
            this.warn.set(c.id, m);
          }
          m.visible = true;
          m.scale.set(1.6, c.len, 1);
          m.rotation.set(-Math.PI / 2, Math.atan2(c.dx, c.dz), 0);
          m.position.set(c.x + (c.dx * c.len) / 2, 0.07, c.z + (c.dz * c.len) / 2);
        } else {
          const m = this.warn.get(c.id);
          if (m) m.visible = false;
        }
      }),
      e.on('bossSlam', (b) => {
        this.ring(b.x, b.z, 0.6, b.r, 0.45, 0xff7a3a);
        this.fx.chips(b.x, b.z, [0.45, 0.4, 0.34], 24, 1.3);
        this.rig.addShake(0.45);
      }),
      e.on('propExploded', ({ x, z, silent }) => this.wreck(x, z, !silent)),
      e.on('pulse', (p) => {
        if (p.stage === 'fire') {
          this.ring(p.x, p.z, 0.5, p.radius, 0.5, 0x88eaff);
          this.fx.chips(p.x, p.z, [1.2, 3.4, 4], 30, 1.4);
          this.rig.addShake(0.35);
        }
      }),
      e.on('scream', (s) => this.ring(s.x, s.z, 0.3, s.radius, 0.7, 0xff5af0)),
      e.on('chainBlast', (c) => this.ring(c.x, c.z, 0.3, 2.2, 0.35, 0xffa040)),
      e.on('shove', ({ hits }) => {
        if (hits > 0) this.rig.addShake(0.12);
      }),
    );
  }

  /** 炸掉的爆炸物：一团焦黑的残骸盖在原地（原来的模型合并在静态网格里，删不掉） */
  private wreck(x: number, z: number, loud: boolean): void {
    const b = new Builder();
    const r = new Rng(Math.round(x * 13 + z * 7));
    for (let i = 0; i < 7; i++) {
      b.rbox(r.range(0.3, 0.8), r.range(0.15, 0.5), r.range(0.3, 0.7), 0.05, { x: r.range(-0.7, 0.7), z: r.range(-0.7, 0.7), ry: r.range(0, 3), rz: r.range(-0.3, 0.3) }, { color: 0x1a1816, jitter: 0.25, ao: 0.4, aoH: 0.4 });
    }
    b.cyl(1.1, 1.3, 0.05, 12, { y: 0.0 }, { color: 0x0e0d0c, jitter: 0.1, ao: 0 });
    const g = toGroup(b.build());
    g.position.set(x, 0, z);
    this.wrecks.add(g);
    if (loud) this.rig.addShake(0.5);
  }

  private ring(x: number, z: number, r0: number, r1: number, life: number, color: number): void {
    const mesh = new Mesh(new RingGeometry(0.9, 1, 64), new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: AdditiveBlending, side: 2 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, r0, r1 });
  }

  /** 让 n 个网格跟着一组位置；多出来的隐藏 */
  private syncPool(pool: Mesh[], items: Array<{ x: number; y: number; z: number }>, make: () => Mesh): void {
    while (pool.length < items.length) {
      const m = make();
      this.scene.add(m);
      pool.push(m);
    }
    for (let i = 0; i < pool.length; i++) {
      const m = pool[i] as Mesh;
      const it = items[i];
      m.visible = !!it;
      if (it) m.position.set(it.x, it.y, it.z);
    }
  }

  /** 风险事件「幸存者求救」的信号弹位置（没有就是 null） */
  private flare: { x: number; z: number } | null = null;
  /** 冒烟的车残骸（M19）：固定挑出来的几辆，烟和火星有距离上限（离玩家 30 米内） */
  private smokers: Array<{ x: number; z: number; fire: boolean }> = [];
  private wreckT = 0;
  /** 环境粒子开关（低画质关） */
  ambient = true;

  update(dt: number): void {
    this.time += dt;
    const g = this.game;
    const h = g.hz;

    // 环境粒子（M19）：冒烟的车。每 0.25 秒挑一辆离玩家 30 米内的冒一口烟，着火的车再冒火星
    if (this.ambient) {
      this.wreckT -= dt;
      if (this.wreckT <= 0 && this.smokers.length) {
        this.wreckT = 0.25;
        const p = g.player;
        for (const w of this.smokers) {
          if (Math.hypot(w.x - p.x, w.z - p.z) > 30) continue;
          this.fx.smoke(w.x + this.rng.range(-0.4, 0.4), 1.1, w.z + this.rng.range(-0.4, 0.4));
          if (w.fire) this.fx.flameLick(w.x + this.rng.range(-0.5, 0.5), w.z + this.rng.range(-0.3, 0.3));
        }
      }
    }

    // 手雷、酸团
    this.syncPool(this.grenadeMeshes, h.thrown, () => new Mesh(this.grenadeGeo, this.grenadeMat));
    this.syncPool(this.spitMeshes, h.spits, () => new Mesh(this.spitGeo, this.spitMat));
    for (const s of h.spits) this.fx.spark(s.x, s.y, s.z, 0.5, 1.6, 0.3);
    for (const t of h.thrown) if (t.fire) this.fx.spark(t.x, t.y + 0.05, t.z, 3, 1.2, 0.3);

    // 地面火焰 / 酸池：持续冒火星和气泡（限流）
    this.emberT -= dt;
    if (this.emberT <= 0) {
      this.emberT = 0.05;
      for (const hz of h.hazards) {
        const a = this.rng.range(0, Math.PI * 2);
        const rr = Math.sqrt(this.rng.next()) * hz.r;
        const x = hz.x + Math.cos(a) * rr;
        const z = hz.z + Math.sin(a) * rr;
        if (hz.kind === 'fire') this.fx.flameLick(x, z);
        else this.fx.spark(x, 0.05, z, 0.5, 1.8, 0.25);
      }
    }

    // 电击脉冲充能圈
    if (h.pulseCharge > 0) {
      this.chargeRing.visible = true;
      this.chargeRing.position.x = g.core.x;
      this.chargeRing.position.z = g.core.z;
      const k = 1 - h.pulseCharge / 1.5;
      this.chargeRing.scale.setScalar(1 + k * 7);
      (this.chargeRing.material as MeshBasicMaterial).opacity = 0.3 + 0.5 * Math.abs(Math.sin(this.time * 18));
    } else this.chargeRing.visible = false;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as MeshBasicMaterial).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k)));
      (r.mesh.material as MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }

    // 空投：信号烟从箱子旁的烟罐冒出，一团接一团往上飘
    this.smokeT -= dt;
    // 烟的来源：空投箱旁的烟罐；没有空投时，换成幸存者的信号弹
    const src = this.drop.visible ? { x: this.drop.position.x + 0.78, z: this.drop.position.z + 0.5 } : this.flare;
    if (src && this.smokeT <= 0) {
      this.smokeT = 0.09;
      const p = this.smoke[this.smokeIdx++ % SMOKE_N]!;
      p.age = 0;
      p.life = this.rng.range(3.2, 4.4);
      p.vx = 0.35 + this.rng.range(-0.12, 0.12);
      p.vz = 0.12 + this.rng.range(-0.12, 0.12);
      p.s0 = this.rng.range(0.35, 0.55);
      p.sp.position.set(src.x, 0.35, src.z);
      p.sp.material.rotation = this.rng.range(0, 6.28);
      p.sp.visible = true;
    }
    for (const p of this.smoke) {
      if (!p.sp.visible) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.sp.visible = false;
        continue;
      }
      // 上升越来越慢、越飘越散
      const rise = 2.2 * Math.exp(-0.5 * p.age);
      p.sp.position.x += p.vx * k * dt * 2;
      p.sp.position.z += p.vz * k * dt * 2;
      p.sp.position.y += rise * dt;
      p.sp.scale.setScalar(p.s0 + 2.4 * Math.sqrt(k));
      p.mat.rotation += dt * 0.25;
      // 刚冒出来浓、颜色鲜，越往上越淡越灰
      p.mat.opacity = Math.min(1, k * 8) * (1 - k) * 0.6;
      p.mat.color.setRGB(0.7 - 0.25 * k, 0.16 + 0.22 * k, 0.12 + 0.24 * k);
    }

    // 首领死了（或从列表里移除）但预警线 / 核心还挂着：一起藏掉
    for (const [id, m] of this.warn) if (m.visible && !g.zombies.some((z) => z.id === id && z.alive && z.chargeState === 1)) m.visible = false;
    for (const [id, m] of this.cores) if (m.visible && !g.zombies.some((z) => z.id === id && z.alive && z.chargeState === 3)) m.visible = false;

    // 首领硬直：胸口核心发光（弱点）；冲锋预警线闪烁
    for (const z of g.zombies) {
      const ch = z.def.charge;
      if (!ch) continue;
      let m = this.cores.get(z.id);
      if (z.chargeState === 3 && z.alive) {
        if (!m) {
          m = new Mesh(this.coreGeo, new MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.85, toneMapped: false, blending: AdditiveBlending, depthWrite: false }));
          this.scene.add(m);
          this.cores.set(z.id, m);
        }
        m.visible = true;
        m.scale.setScalar(ch.core.r * (1 + 0.15 * Math.sin(this.time * 12)));
        m.position.set(z.x + Math.sin(z.yaw) * z.radius * 0.7, ch.core.y, z.z + Math.cos(z.yaw) * z.radius * 0.7);
      } else if (m) m.visible = false;
      const w = this.warn.get(z.id);
      if (w?.visible) (w.material as MeshBasicMaterial).opacity = 0.3 + 0.35 * Math.abs(Math.sin(this.time * 14));
      if (w && (!z.alive || z.chargeState !== 1)) w.visible = false;
    }

    // 手电筒：跟着相机走，指向视线前方；没电时闪两下
    const cam = this.rig.camera;
    const on = g.flashOn && this.rig.mode === 'fps';
    const low = g.battery < 2 && Math.sin(this.time * 40) > 0.6;
    // 灯一直在场景里、关的时候亮度为 0：灯的数量变了 three 会把所有材质的着色器重新编译一遍，按 T 会卡一下
    this.flash.intensity = on ? (low ? 8 : 26) : 0;
    if (on) {
      cam.getWorldPosition(this.flash.position);
      this.flash.position.y -= 0.15;
      cam.getWorldDirection(this.flashTarget.position);
      this.flashTarget.position.multiplyScalar(10).add(this.flash.position);
    }

    // 浓雾词缀：夜里雾浓度加倍；停电：路灯熄灭
    const m = g.run.phase === 'night' && g.run.mod ? nightMod(g.run.mod) : null;
    this.lighting.fogMult = m ? m.fog : 1;
    this.lighting.lampsOff = !!m && g.run.mod === 'blackout';
  }

  dispose(): void {
    for (const f of this.off) f();
    this.scene.remove(this.wrecks, this.flash, this.flashTarget, this.chargeRing, this.drop);
    for (const p of this.smoke) {
      this.scene.remove(p.sp);
      p.mat.dispose();
    }
    this.smoke[0]?.mat.map?.dispose();
    for (const m of [...this.warn.values(), ...this.cores.values()]) {
      this.scene.remove(m);
      (m.material as MeshBasicMaterial).dispose();
    }
    this.warnGeo.dispose();
    this.coreGeo.dispose();
    for (const m of [...this.grenadeMeshes, ...this.spitMeshes]) this.scene.remove(m);
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.grenadeGeo.dispose();
    this.spitGeo.dispose();
    this.grenadeMat.dispose();
    this.spitMat.dispose();
  }
}

const SMOKE_N = 48;

/** 柔边烟团：几个错开的径向渐变叠在一起，边缘不规则 */
function smokeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const r = new Rng(77);
  for (let i = 0; i < 7; i++) {
    const x = 64 + r.range(-18, 18);
    const y = 64 + r.range(-18, 18);
    const rad = r.range(30, 46);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(c);
}

/**
 * 空投箱：木托盘 + 军绿色金属箱（边框、加强筋、提手、锁扣、绑带、白色喷字），
 * 旁边一顶摊在地上的降落伞和插在地上的红色烟罐
 */
function airdropModel(): Builder {
  const b = new Builder();
  const wood = { color: 0x7a5a3a, jitter: 0.18, ao: 0.4, aoH: 0.3 };
  const green = { color: 0x4a5634, jitter: 0.08, ao: 0.35, aoH: 0.9, mat: 'metal' as const };
  const dark = { color: 0x2c3222, jitter: 0.06, ao: 0, mat: 'metal' as const };
  const steel = { color: 0x8a8e88, jitter: 0.08, ao: 0, mat: 'metal' as const };
  const strap = { color: 0x1e1f1a, jitter: 0.05, ao: 0 };
  // 托盘：三根垫木 + 面板
  for (const z of [-0.5, 0, 0.5]) b.box(1.2, 0.1, 0.12, { y: 0.05, z }, wood);
  for (let i = 0; i < 7; i++) b.box(0.15, 0.025, 1.2, { x: -0.54 + i * 0.18, y: 0.112 }, wood);
  // 箱体
  const y0 = 0.125;
  const W = 1.08;
  const H = 0.78;
  b.rbox(W, H, W * 0.9, 0.03, { y: y0 }, green);
  // 边框
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(0.05, H + 0.01, 0.05, { x: (x * W) / 2, y: y0, z: (z * W * 0.9) / 2 }, dark);
  for (const yy of [y0, y0 + H - 0.04]) {
    for (const z of [-1, 1]) b.box(W + 0.02, 0.05, 0.05, { y: yy, z: (z * W * 0.9) / 2 }, dark);
    for (const x of [-1, 1]) b.box(0.05, 0.05, W * 0.9, { x: (x * W) / 2, y: yy }, dark);
  }
  // 两侧加强筋
  for (let i = 0; i < 4; i++) for (const z of [-1, 1]) b.box(0.035, H - 0.12, 0.02, { x: -0.36 + i * 0.24, y: y0 + 0.06, z: z * (W * 0.45 + 0.01) }, dark);
  // 喷字面板 + 十字
  b.box(0.44, 0.26, 0.012, { y: y0 + 0.34, z: W * 0.45 + 0.025 }, { color: 0xe6dfc8, jitter: 0.06, ao: 0 });
  b.box(0.06, 0.18, 0.014, { y: y0 + 0.38, z: W * 0.45 + 0.03 }, { color: 0xb02a20, jitter: 0, ao: 0 });
  b.box(0.18, 0.06, 0.014, { y: y0 + 0.44, z: W * 0.45 + 0.03 }, { color: 0xb02a20, jitter: 0, ao: 0 });
  // 提手、锁扣
  for (const x of [-1, 1]) b.box(0.03, 0.06, 0.24, { x: x * (W / 2 + 0.03), y: y0 + 0.5 }, steel);
  for (const x of [-0.3, 0.3]) b.box(0.08, 0.1, 0.03, { x, y: y0 + H - 0.14, z: W * 0.45 + 0.025 }, steel);
  // 交叉绑带
  for (const x of [-0.22, 0.22]) {
    b.box(0.07, 0.012, W * 0.9 + 0.04, { x, y: y0 + H + 0.002 }, strap);
    for (const z of [-1, 1]) b.box(0.07, H, 0.012, { x, y: y0, z: z * (W * 0.45 + 0.02) }, strap);
  }
  // 降落伞：摊在箱子后面地上的一堆布，几道起伏的布褶 + 伞绳
  const silk = { color: 0x8a8c6a, jitter: 0.1, ao: 0.3, aoH: 0.3 };
  const silk2 = { color: 0xcfc8b0, jitter: 0.08, ao: 0.3, aoH: 0.3 };
  for (let i = 0; i < 6; i++) {
    b.sphere(0.5, 10, 6, { x: -0.9 + i * 0.22, y: 0.02, z: -1.05 - (i % 2) * 0.18, sx: 0.9, sy: 0.22 + (i % 3) * 0.05, sz: 1.3, ry: i * 0.35 }, i % 2 ? silk : silk2);
  }
  for (const x of [-0.4, -0.15, 0.15, 0.4]) b.rod([x, y0 + H, -0.4], [x * 1.6, 0.08, -0.95], 0.006, strap, 3);
  // 烟罐：插在地上，罐口发红光
  b.cyl(0.045, 0.05, 0.28, 8, { x: 0.78, z: 0.5 }, { color: 0xa82a1e, jitter: 0.05, ao: 0, mat: 'metal' });
  b.cyl(0.03, 0.03, 0.04, 8, { x: 0.78, y: 0.28, z: 0.5 }, { color: 0xff5a2a, mat: 'glow', glow: 3.2 });
  return b;
}
