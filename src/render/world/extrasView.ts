import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RingGeometry, Scene, SphereGeometry, SpotLight } from 'three';
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
    this.flash = new SpotLight(0xfff2d8, 0, FLASHLIGHT.range, 0.38, 0.45, 1.4);
    this.flash.castShadow = false;
    this.flash.target = this.flashTarget;
    scene.add(this.flash, this.flashTarget);

    this.chargeRing = new Mesh(new RingGeometry(0.97, 1, 64), new MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: AdditiveBlending, side: 2 }));
    this.chargeRing.rotation.x = -Math.PI / 2;
    this.chargeRing.position.y = 0.06;
    this.chargeRing.visible = false;
    scene.add(this.chargeRing);

    // 空投箱
    const b = new Builder();
    b.rbox(0.9, 0.6, 0.9, 0.05, {}, { color: 0x4d5a3a, jitter: 0.12, ao: 0.3, aoH: 0.6 });
    for (const z of [-0.3, 0.3]) b.box(0.94, 0.08, 0.06, { y: 0.26, z }, { color: 0x2a2e26, jitter: 0.1, ao: 0 });
    b.box(0.3, 0.2, 0.01, { y: 0.32, z: 0.456 }, { color: 0xe8e0c8, jitter: 0.05, ao: 0 });
    b.cyl(0.04, 0.04, 0.5, 6, { x: 0.5, y: 0 }, { color: 0x2a2a2a, mat: 'metal', ao: 0 });
    b.cyl(0.05, 0.05, 0.08, 6, { x: 0.5, y: 0.5 }, { color: 0xff3a1a, mat: 'glow', glow: 3 });
    this.drop.add(toGroup(b.build()));
    this.drop.visible = false;
    scene.add(this.drop);

    const e = game.events;
    this.off.push(
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

  update(dt: number): void {
    this.time += dt;
    const g = this.game;
    const h = g.hz;

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

    // 空投：烟柱和闪烁的信号灯
    if (this.drop.visible) {
      if (this.rng.next() < 0.5) this.fx.smoke(this.drop.position.x + 0.5, 0.6, this.drop.position.z);
    }

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
    this.flash.intensity = on ? (low ? 15 : 60) : 0;
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
