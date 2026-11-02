import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { clamp } from '../game/core/math';
import type { WeaponKind } from '../game/data/weapons';
import { Builder, toGroup, type Style } from './kit';
import type { Lighting } from './lighting';
import { buildWeapon, type WeaponModel } from './models/weapons';

/**
 * 第一人称视角模型：枪和双臂挂在"相机空间"里，用单独的场景和相机、在世界之后再画一遍（先清深度），
 * 所以贴着墙、被僵尸挡住时枪也不会穿进去。
 */

/** 各武器在相机空间里的位置（后握把）和缩放。第一人称里枪要比真实比例略大一点才好看 */
const PLACE: Record<WeaponKind, { x: number; y: number; z: number; s: number }> = {
  pistol: { x: 0.125, y: -0.125, z: -0.27, s: 1.35 },
  smg: { x: 0.16, y: -0.15, z: -0.26, s: 1.12 },
  shotgun: { x: 0.17, y: -0.17, z: -0.24, s: 1.0 },
  rifle: { x: 0.175, y: -0.175, z: -0.22, s: 1.0 },
  launcher: { x: 0.2, y: -0.215, z: -0.25, s: 0.9 },
};

/** 枪口火光亮度（近距离点光源，数值比世界里的小得多） */
const FLASH_LIGHT: Record<WeaponKind, number> = { pistol: 2.2, smg: 2, shotgun: 5.5, rifle: 3, launcher: 6.5 };
const FLASH_SIZE: Record<WeaponKind, number> = { pistol: 0.8, smg: 0.75, shotgun: 1.3, rifle: 0.95, launcher: 1.5 };

const SHIRT = 0x5a5f4a;
const FOREARM = 0x4c5240;
const GLOVE = 0x1c1c1a;
const GUARD = 0x23251d;

const Z_AXIS = new Vector3(0, 0, 1);
const ease = (x: number) => x * x * (3 - 2 * x);

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

const matte = (color: number): Style => ({ color, jitter: 0.1, ao: 0.15, aoH: 0.4 });

/** 一段手臂：沿 +Z 方向长度为 1 的方柱，用 scale.z 拉到需要的长度 */
function limb(w: number, color: number): Group {
  const b = new Builder();
  b.box(w, w, 1, { y: -w / 2, z: 0.5 }, matte(color));
  return toGroup(b.build(), { castShadow: false, receiveShadow: false });
}

function glove(): Group {
  const b = new Builder();
  b.rbox(0.088, 0.082, 0.12, 0.02, { y: -0.041, z: 0.0 }, matte(GLOVE));
  // 拇指和指节
  b.rbox(0.03, 0.03, 0.07, 0.01, { x: 0.036, y: 0.01, z: 0.02 }, matte(GLOVE));
  for (let i = -1; i <= 1; i++) b.rbox(0.024, 0.026, 0.05, 0.008, { x: i * 0.028, y: -0.05, z: 0.07 }, matte(GLOVE));
  return toGroup(b.build(), { castShadow: false, receiveShadow: false });
}

class Arm {
  readonly upper = limb(0.1, SHIRT);
  readonly fore = limb(0.088, FOREARM);
  readonly guard = limb(0.095, GUARD);
  readonly hand = glove();
  readonly root = new Group();
  readonly elbow = new Vector3();

  constructor() {
    this.root.add(this.upper, this.fore, this.guard, this.hand);
  }

  private readonly d = new Vector3();
  private readonly n = new Vector3();

  /** 两段骨头的简易 IK：肩膀固定在 s，手在 t，肘部朝 pole 方向弯 */
  solve(s: Vector3, t: Vector3, pole: Vector3): void {
    const d = this.d.subVectors(t, s);
    const full = Math.max(0.05, d.length());
    // 手臂长度跟着距离走，总是留一点弯曲，这样不同的枪都够得着
    const l = Math.max(0.34, full / 1.85);
    const dist = Math.min(full, l * 2 - 0.002);
    d.multiplyScalar(1 / full);
    const a = dist / 2;
    const h = Math.sqrt(Math.max(0, l * l - a * a));
    const n = this.n.copy(pole).addScaledVector(d, -pole.dot(d));
    if (n.lengthSq() < 1e-6) n.set(0, -1, 0);
    n.normalize();
    this.elbow.copy(s).addScaledVector(d, a).addScaledVector(n, h);
    // 手腕的实际位置（够不着时停在最远处，手套仍然放在目标上）
    this.place(this.upper, s, this.elbow, 1);
    this.place(this.fore, this.elbow, t, 1);
    // 护腕套在前臂靠近手的一段
    const wrist = this.d.copy(t).sub(this.elbow);
    const wl = wrist.length() || 1;
    wrist.multiplyScalar(1 / wl);
    this.guard.position.copy(t).addScaledVector(wrist, -0.11);
    this.guard.quaternion.setFromUnitVectors(Z_AXIS, wrist);
    this.guard.scale.set(1, 1, 0.1);
    this.hand.position.copy(t);
    this.hand.quaternion.setFromUnitVectors(Z_AXIS, wrist);
  }

  private place(obj: Object3D, a: Vector3, b: Vector3, thick: number): void {
    const d = this.d.subVectors(b, a);
    const len = Math.max(0.01, d.length());
    obj.position.copy(a);
    obj.quaternion.setFromUnitVectors(Z_AXIS, d.multiplyScalar(1 / len));
    obj.scale.set(thick, thick, len);
  }
}

export interface ViewModelState {
  kind: WeaponKind;
  tier: number;
  alive: boolean;
  /** 建造模式：枪放低 */
  lowered: boolean;
  /** 换弹进度 0–1，-1 = 没在换弹 */
  reload: number;
  /** 开火后坐力 0–1 */
  recoil: number;
  speed: number;
  sprinting: boolean;
  yaw: number;
  pitch: number;
}

export class ViewModel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(74, 1, 0.02, 8);
  visible = false;

  private readonly root = new Group();
  private weapon: WeaponModel | null = null;
  private key = '';
  private lastKindForRaise: WeaponKind | null = null;
  private raise = 1;

  private readonly flash = new Group();
  private readonly flashLight = new PointLight(0xffa860, 0, 3.2, 2);
  private flashT = 0;
  private flashPeak = 0;

  private readonly armR = new Arm();
  private readonly armL = new Arm();
  private readonly shoulderR = new Vector3(0.3, -0.36, 0.3);
  private readonly shoulderL = new Vector3(-0.3, -0.38, 0.12);
  private readonly poleR = new Vector3(0.5, -1, 0.15);
  private readonly poleL = new Vector3(-0.6, -1, 0.25);
  private readonly gripR = new Vector3();
  private readonly gripL = new Vector3();

  private t = 0;
  private bobT = 0;
  private bobAmp = 0;
  private sprintK = 0;
  private lowerK = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private haveLast = false;

  private readonly hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  private readonly sun = new DirectionalLight(0xffffff, 1);
  private readonly q = new Quaternion();
  private readonly dirCam = new Vector3();

  constructor() {
    this.scene.add(this.camera);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.add(this.root);
    this.scene.add(this.armR.root, this.armL.root);
    this.scene.add(this.flashLight);

    // 枪口火光：两张交叉的发光面片 + 中心一张
    const tex = flashTexture();
    // 从枪后面往前看，面片的背面朝向镜头，所以必须双面
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: new Color(2.4, 1.7, 1.0), side: DoubleSide });
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
    this.root.rotation.order = 'YXZ';
  }

  /** 世界环境贴图和光照同步到这个独立场景（光不能同时挂在两个场景里） */
  sync(main: PerspectiveCamera, world: Scene, lighting: Lighting): void {
    if (this.camera.fov !== main.fov || this.camera.aspect !== main.aspect) {
      this.camera.fov = main.fov;
      this.camera.aspect = main.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.scene.environment = world.environment;
    this.hemi.color.copy(lighting.hemi.color);
    this.hemi.groundColor.copy(lighting.hemi.groundColor);
    // 枪和手离镜头很近，要比远处的世界更亮一点，否则夜里只剩一团黑
    this.hemi.intensity = Math.max(1.3, lighting.hemi.intensity * 1.2);
    this.sun.color.copy(lighting.sun.color);
    this.sun.intensity = Math.max(1.6, lighting.sun.intensity);
    this.scene.environmentIntensity = Math.max(0.55, world.environmentIntensity);
    // 太阳方向从世界空间转到相机空间
    this.q.copy(main.quaternion).invert();
    this.dirCam.copy(lighting.dir).applyQuaternion(this.q);
    this.sun.position.copy(this.dirCam).multiplyScalar(5);
  }

  private setWeapon(kind: WeaponKind, tier: number): void {
    const key = `${kind}:${tier}`;
    if (key === this.key) return;
    const first = this.key === '';
    this.key = key;
    if (this.weapon) {
      // 火光是共用的，先摘下来再清理旧枪，免得把它的几何体一起释放
      this.flash.removeFromParent();
      this.root.remove(this.weapon.group);
      this.weapon.group.traverse((o) => {
        const m = o as { geometry?: { dispose(): void } };
        m.geometry?.dispose();
      });
    }
    const w = buildWeapon(kind, tier);
    w.group.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    w.group.add(this.flash);
    this.flash.position.copy(w.muzzle);
    this.weapon = w;
    this.root.add(w.group);
    // 换枪（以及开局第一次拿枪）都有一个举枪的过程；升级同一把枪不重播
    if (first || kind !== this.lastKindForRaise) this.raise = 1;
    this.lastKindForRaise = kind;
  }

  /** 开火：枪口火光 + 近处补光 */
  fire(kind: WeaponKind): void {
    const k = FLASH_SIZE[kind] * (0.85 + Math.random() * 0.3);
    const s = PLACE[kind].s;
    this.flash.scale.setScalar((0.3 * k) / s);
    this.flash.rotation.z = Math.random() * 6.28;
    this.flash.visible = true;
    this.flashT = 0.055;
    this.flashPeak = FLASH_LIGHT[kind];
  }

  /** 枪口的世界坐标（抛壳、曳光起点用）。mainCamera 必须已经更新过矩阵 */
  muzzleWorld(out: Vector3, main: PerspectiveCamera): Vector3 {
    const w = this.weapon;
    if (!w) return out.copy(main.position);
    this.root.updateMatrixWorld(true);
    w.group.localToWorld(out.copy(w.muzzle));
    main.updateMatrixWorld();
    return out.applyMatrix4(main.matrixWorld);
  }

  update(dt: number, s: ViewModelState): void {
    this.setWeapon(s.kind, s.tier);
    const w = this.weapon;
    if (!w) return;
    this.t += dt;
    const base = PLACE[s.kind];

    this.raise = Math.max(0, this.raise - dt / 0.34);
    const raiseK = ease(this.raise);
    this.sprintK += ((s.sprinting && s.speed > 1.2 ? 1 : 0) - this.sprintK) * (1 - Math.exp(-9 * dt));
    this.lowerK += ((s.lowered ? 1 : 0) - this.lowerK) * (1 - Math.exp(-8 * dt));
    const reloadK = s.reload >= 0 ? Math.sin(Math.PI * Math.min(1, s.reload)) : 0;

    // 步伐起伏（和相机同一个节奏）
    this.bobAmp += (Math.min(1, s.speed / 3.4) - this.bobAmp) * (1 - Math.exp(-10 * dt));
    this.bobT += dt * s.speed * 1.7;
    const bobX = Math.sin(this.bobT) * 0.012 * this.bobAmp * (1 + this.sprintK * 0.8);
    const bobY = Math.sin(this.bobT * 2) * 0.009 * this.bobAmp * (1 + this.sprintK * 0.8);
    const idleY = Math.sin(this.t * 1.7) * 0.0025;

    // 视角转动时枪稍微滞后，像有重量
    if (this.haveLast && dt > 0) {
      let dy = s.yaw - this.lastYaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      else if (dy < -Math.PI) dy += Math.PI * 2;
      const yawRate = clamp(dy / dt, -9, 9);
      const pitchRate = clamp((s.pitch - this.lastPitch) / dt, -9, 9);
      const k = 1 - Math.exp(-10 * dt);
      this.swayX += (clamp(yawRate * 0.011, -0.055, 0.055) - this.swayX) * k;
      this.swayY += (clamp(-pitchRate * 0.011, -0.04, 0.04) - this.swayY) * k;
    }
    this.lastYaw = s.yaw;
    this.lastPitch = s.pitch;
    this.haveLast = true;

    const r = s.recoil;
    const px = base.x + this.swayX + bobX - 0.045 * reloadK + 0.07 * this.sprintK - 0.03 * this.lowerK;
    const py = base.y + this.swayY + bobY + idleY - 0.1 * reloadK - 0.34 * raiseK - 0.11 * this.sprintK - 0.13 * this.lowerK;
    const pz = base.z + 0.055 * r + 0.03 * reloadK + 0.03 * this.sprintK;
    this.root.position.set(px, py, pz);
    this.root.scale.setScalar(base.s);
    this.root.rotation.set(
      0.13 * r - 0.62 * reloadK - 0.85 * raiseK - 0.3 * this.sprintK - 0.28 * this.lowerK,
      Math.PI + 0.5 * this.sprintK + 0.12 * reloadK,
      0.55 * reloadK - 0.35 * this.sprintK + 0.04 * Math.sin(this.bobT) * this.bobAmp,
    );

    // 火光衰减
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = this.flashPeak * clamp(this.flashT / 0.055, 0, 1);
      w.group.localToWorld(this.flashLight.position.copy(w.muzzle));
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }

    // 双手跟着枪的握点（IK）
    this.root.updateMatrixWorld(true);
    w.group.localToWorld(this.gripR.copy(w.gripR));
    w.group.localToWorld(this.gripL.copy(w.gripL));
    this.armR.solve(this.shoulderR, this.gripR, this.poleR);
    this.armL.solve(this.shoulderL, this.gripL, this.poleL);

    this.visible = s.alive;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
    });
  }
}
