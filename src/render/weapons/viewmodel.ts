import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { clamp, lerp } from '../../game/core/math';
import type { WeaponKind } from '../../game/data/weapons';
import type { Lighting } from '../core/lighting';
import { loadTacz, loadTaczManifest, TACZ_SCALE, type TaczRig } from '../tacz/rig';
import { Arm } from './arms';
import { buildWeapon, type WeaponModel } from './';

/**
 * 第一人称视角模型：枪和双臂挂在"相机空间"里，用单独的场景和相机、在世界之后再画一遍（先清深度），
 * 所以贴着墙、被僵尸挡住时枪也不会穿进去。
 *
 * 动作参考现代第一人称射击游戏：
 * - 右键瞄准：枪平移到屏幕中央，照门 / 红点 / 镜筒正好对准屏幕中心，视角模型自己的视野也收窄；
 * - 开火：整枪后坐 + 上扬，套筒 / 拉机柄后坐，泵动枪拉护木，栓动枪拉栓，转轮转 60°，弹链往里走；
 * - 换弹：枪向内侧倾斜，弹匣掉出、左手去拿新弹匣再插回去（霰弹枪一发发塞）；
 * - 冲刺：战术冲刺姿势，枪口朝上斜举；冲刺结束要把枪放回来才能开火；
 * - 滑铲、蹲伏：枪身倾斜；近战：枪托向左前方挥出去。
 */

/** 各武器在相机空间里腰射时的位置（后握把）和缩放。第一人称里枪要比真实比例略大一点才好看 */
const PLACE: Record<WeaponKind, { x: number; y: number; z: number; s: number }> = {
  pistol: { x: 0.12, y: -0.13, z: -0.3, s: 1.3 },
  smg: { x: 0.15, y: -0.15, z: -0.26, s: 1.1 },
  shotgun: { x: 0.16, y: -0.165, z: -0.22, s: 1.0 },
  rifle: { x: 0.165, y: -0.17, z: -0.22, s: 1.0 },
  sniper: { x: 0.165, y: -0.18, z: -0.2, s: 0.95 },
  lmg: { x: 0.18, y: -0.19, z: -0.22, s: 0.95 },
  launcher: { x: 0.2, y: -0.21, z: -0.25, s: 0.9 },
};

/** 枪口火光亮度（近距离点光源，数值比世界里的小得多） */
const FLASH_LIGHT: Record<WeaponKind, number> = { pistol: 2.2, smg: 2, shotgun: 5.5, rifle: 3, sniper: 5, lmg: 3.2, launcher: 6.5 };
const FLASH_SIZE: Record<WeaponKind, number> = { pistol: 0.8, smg: 0.75, shotgun: 1.3, rifle: 0.95, sniper: 1.4, lmg: 1.05, launcher: 1.5 };
/** FLASH_SIZE 按枪口离镜头这么远（米，程序模型腰射时大约的距离）调的；更近就按比例缩小 */
const FLASH_REF_DIST = 0.55;
/** 开火时整枪后坐的力度 */
const KICK: Record<WeaponKind, number> = { pistol: 1, smg: 0.55, shotgun: 1.8, rifle: 0.75, sniper: 2.2, lmg: 0.7, launcher: 1.9 };

/** 视角模型自己的视野（度）：腰射 / 完全瞄准。和世界相机分开，世界放大时枪不会被放大成一堵墙 */
const VM_FOV_HIP = 68;
const VM_FOV_ADS = 50;

const ease = (x: number) => x * x * (3 - 2 * x);
/** 0→1→0 的平滑脉冲，峰值在 peak 处 */
const pulse = (x: number, peak = 0.3) => (x <= 0 || x >= 1 ? 0 : x < peak ? ease(x / peak) : ease(1 - (x - peak) / (1 - peak)));

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

export interface ViewModelState {
  kind: WeaponKind;
  /** 这把枪瞄准时是不是瞄准镜（举到一半就切成镜框遮罩，枪模不能先把画面堵住） */
  scope: boolean;
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
  /** 瞄准进度 0–1 */
  ads: number;
  /** 近战进度 0–1，-1 = 没在近战 */
  melee: number;
  crouch: number;
  sliding: boolean;
  /** 冲刺结束后的抬枪时间（秒） */
  sprintOut: number;
  /** 弹匣里剩几发 / 容量（TACZ 枪：战术 / 空仓换弹、空仓挂机、逐发装填塞几发） */
  mag: number;
  magMax: number;
  /** 前进 / 右移速度（米/秒，带符号；TACZ 枪选走路动画） */
  fwd: number;
  side: number;
}

export class ViewModel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(VM_FOV_HIP, 1, 0.01, 8);
  visible = false;

  /** TACZ 枪的摄像机动画（每帧更新），世界相机也要乘上它 */
  readonly cameraAnim = new Quaternion();
  /** TACZ 枪的动画音效 */
  onSound: ((url: string, gain: number) => void) | null = null;
  /** 某种武器的 TACZ 模型加载好了（音频层据此预加载音效、关掉合成的枪声） */
  onTaczReady: ((kind: WeaponKind, urls: string[]) => void) | null = null;

  private readonly root = new Group();
  private weapon: WeaponModel | null = null;
  private readonly tacz = new Map<WeaponKind, TaczRig>();
  private taczRig: TaczRig | null = null;
  private readonly pre = new Matrix4();
  private readonly preRot = new Matrix4();
  private readonly preEuler = new Euler(0, 0, 0, 'YXZ');
  private key = '';
  private lastKindForRaise: WeaponKind | null = null;
  private raise = 1;

  private readonly flash = new Group();
  private readonly flashLight = new PointLight(0xffa860, 0, 3.2, 2);
  private flashT = 0;
  private flashPeak = 0;

  private readonly armR = new Arm(false);
  private readonly armL = new Arm(true);
  private readonly shoulderR = new Vector3(0.28, -0.36, 0.3);
  private readonly shoulderL = new Vector3(-0.28, -0.38, 0.14);
  private readonly poleR = new Vector3(0.5, -1, 0.15);
  private readonly poleL = new Vector3(-0.6, -1, 0.25);
  private readonly gripR = new Vector3();
  private readonly gripL = new Vector3();
  private readonly tmp = new Vector3();

  private t = 0;
  private bobT = 0;
  private bobAmp = 0;
  private sprintK = 0;
  private lowerK = 0;
  private slideK = 0;
  private crouchK = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private haveLast = false;
  /** 开火循环：上一发之后经过的时间、这把枪两发的间隔 */
  private cycleT = 9;
  private cycleLen = 0.3;
  /** 整枪后坐：弹簧阻尼，开火时给一个冲量 */
  private kickZ = 0;
  private kickV = 0;
  private kickRot = 0;
  private kickRotV = 0;
  private kickSide = 0;
  /** 转轮当前角度、弹链偏移 */
  private drumA = 0;
  private drumTarget = 0;
  private beltK = 0;
  private adsK = 0;
  private fovNow = VM_FOV_HIP;
  private mainAspect = 1;

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
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, color: new Color(1.7, 1.2, 0.7), side: DoubleSide });
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

    // TACZ 模型异步加载（清单由 npm run tacz:import 生成）；加载好之前、加载失败、没启用时继续用程序模型
    void loadTaczManifest().then((guns) => {
      for (const [kind, id] of Object.entries(guns) as Array<[WeaponKind, string]>) {
        loadTacz(id)
          .then((rig) => {
            if (this.disposed) {
              rig.dispose();
              return;
            }
            rig.onSound = (url, gain) => this.onSound?.(url, gain);
            this.tacz.set(kind, rig);
            this.onTaczReady?.(kind, rig.soundUrls());
          })
          .catch((e: unknown) => console.warn(`TACZ 模型 ${id} 加载失败，继续用程序模型：`, e));
      }
    });
  }

  private disposed = false;

  /** 调试 / 截图用：哪些武器的 TACZ 模型已经加载好了 */
  taczLoaded(): WeaponKind[] {
    return [...this.tacz.keys()];
  }

  /** 检视武器（TACZ 枪才有动画） */
  inspect(): void {
    this.taczRig?.inspect();
  }

  /** 调试用：当前 TACZ 枪直接播一个动画片段 */
  debugPlay(name: string): boolean {
    return this.taczRig?.debugPlay(name) ?? false;
  }

  /** 调试用：当前 TACZ 枪某个动作对应的片段名（截图脚本用） */
  debugRole(role: 'reloadTactical' | 'reloadEmpty' | 'inspect' | 'draw'): string {
    const r = this.taczRig?.json.roles[role];
    return (Array.isArray(r) ? r[0] : r) ?? '';
  }

  /** 世界环境贴图和光照同步到这个独立场景（光不能同时挂在两个场景里） */
  sync(main: PerspectiveCamera, world: Scene, lighting: Lighting): void {
    this.mainAspect = main.aspect;
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
    const rig = this.tacz.get(kind) ?? null;
    const key = `${kind}:${tier}:${rig ? 'tacz' : 'kit'}`;
    if (key === this.key) return;
    const first = this.key === '';
    const newKind = first || kind !== this.lastKindForRaise;
    this.key = key;
    this.lastKindForRaise = kind;
    // 火光是共用的，先摘下来再清理旧枪，免得把它的几何体一起释放
    this.flash.removeFromParent();
    if (this.weapon) {
      this.root.remove(this.weapon.group);
      this.weapon.group.traverse((o) => {
        const m = o as { geometry?: { dispose(): void } };
        m.geometry?.dispose();
      });
      this.weapon = null;
    }
    if (this.taczRig) {
      // TACZ 模型是缓存的，换回来还要用，只摘下不释放
      this.scene.remove(this.taczRig.root);
      this.taczRig = null;
    }
    this.cameraAnim.identity();

    if (rig) {
      // TACZ 枪：手臂是模型自带的，掏枪 / 举枪由动画负责
      this.taczRig = rig;
      this.scene.add(rig.root);
      rig.flashMount.add(this.flash);
      this.flash.position.set(0, 0, 0);
      this.armR.root.visible = this.armL.root.visible = false;
      if (newKind) rig.draw();
      return;
    }
    this.armR.root.visible = this.armL.root.visible = true;
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
    if (newKind) {
      this.raise = 1;
      this.drumA = this.drumTarget = 0;
    }
  }

  /** 开火：枪口火光 + 近处补光 + 整枪后坐 + 机构动作。interval = 两发之间的秒数 */
  fire(kind: WeaponKind, interval = 0.3, last = false): void {
    const k = FLASH_SIZE[kind] * (0.85 + Math.random() * 0.3);
    const s = this.taczRig ? TACZ_SCALE : PLACE[kind].s;
    // 火光按"屏幕上看起来多大"来定：枪口离镜头越近（TACZ 手枪腰射只有 0.25 米、开镜时枪口就在眼前），
    // 同样的世界尺寸在屏幕上就越大，不按距离缩放会糊满全屏。开镜时再小一点，不挡准星
    this.root.updateMatrixWorld(true);
    this.taczRig?.root.updateMatrixWorld(true);
    this.flash.parent?.getWorldPosition(this.tmp);
    this.camera.worldToLocal(this.tmp);
    const near = clamp(-this.tmp.z / FLASH_REF_DIST, 0.25, 1);
    this.flash.scale.setScalar(((0.3 * k) / s) * near * (1 - 0.55 * this.adsK));
    this.flash.rotation.z = Math.random() * 6.28;
    this.flash.visible = true;
    this.flashT = 0.055;
    // 补光也一样：离得近时手臂、袖子会被照成一大片橙色
    this.flashPeak = FLASH_LIGHT[kind] * near * near;
    if (this.taczRig) {
      // 后坐、套筒都在 TACZ 的 shoot 动画里
      this.taczRig.fire(Math.max(0.06, interval), last);
      return;
    }
    this.cycleT = 0;
    this.cycleLen = Math.max(0.06, interval);
    const kick = KICK[kind] * (1 - 0.45 * this.adsK);
    this.kickV += 1.6 * kick;
    this.kickRotV += 9 * kick;
    this.kickSide = (Math.random() * 2 - 1) * 0.012 * kick;
    if (kind === 'launcher') this.drumTarget += Math.PI / 3;
    if (kind === 'lmg') this.beltK = 1;
  }

  /** 枪口的世界坐标（抛壳、曳光起点用）。mainCamera 必须已经更新过矩阵 */
  muzzleWorld(out: Vector3, main: PerspectiveCamera): Vector3 {
    const w = this.weapon;
    if (this.taczRig) this.taczRig.muzzleLocal(out);
    else if (w) {
      this.root.updateMatrixWorld(true);
      w.group.localToWorld(out.copy(w.muzzle));
    } else return out.copy(main.position);
    // 视角模型的视野和世界相机不一样：按投影把点换算到世界相机里同一个屏幕位置
    const k = Math.tan((main.fov * Math.PI) / 360) / Math.tan((this.camera.fov * Math.PI) / 360);
    out.x *= k;
    out.y *= k;
    main.updateMatrixWorld();
    return out.applyMatrix4(main.matrixWorld);
  }

  update(dt: number, s: ViewModelState): void {
    this.setWeapon(s.kind, s.tier);
    if (this.taczRig) {
      this.updateTacz(dt, s, this.taczRig);
      return;
    }
    const w = this.weapon;
    if (!w) return;
    this.t += dt;
    const base = PLACE[s.kind];

    this.raise = Math.max(0, this.raise - dt / 0.34);
    const raiseK = ease(this.raise);
    const sprintOutK = clamp(s.sprintOut / 0.14, 0, 1);
    this.sprintK += ((s.sprinting && s.speed > 1.2 ? 1 : sprintOutK) - this.sprintK) * (1 - Math.exp(-12 * dt));
    this.lowerK += ((s.lowered ? 1 : 0) - this.lowerK) * (1 - Math.exp(-8 * dt));
    this.slideK += ((s.sliding ? 1 : 0) - this.slideK) * (1 - Math.exp(-10 * dt));
    this.crouchK += (s.crouch - this.crouchK) * (1 - Math.exp(-10 * dt));
    this.adsK = ease(clamp(s.ads, 0, 1));
    const aimK = this.adsK;
    const loose = 1 - 0.85 * aimK; // 瞄准时晃动、起伏都小很多
    const reloading = s.reload >= 0;
    const reloadK = reloading ? pulse(Math.min(1, s.reload), 0.18) : 0;
    const meleeK = s.melee >= 0 ? pulse(s.melee, 0.25) : 0;

    // 视角模型自己的视野：瞄准时收窄，枪看起来更近更大
    this.fovNow = lerp(VM_FOV_HIP, VM_FOV_ADS, aimK);
    if (Math.abs(this.camera.fov - this.fovNow) > 0.01 || this.camera.aspect !== this.mainAspect) {
      this.camera.fov = this.fovNow;
      this.camera.aspect = this.mainAspect;
      this.camera.updateProjectionMatrix();
    }

    // 步伐起伏（和相机同一个节奏）
    this.bobAmp += (Math.min(1, s.speed / 3.4) - this.bobAmp) * (1 - Math.exp(-10 * dt));
    this.bobT += dt * s.speed * 1.7;
    const bobK = this.bobAmp * (1 + this.sprintK * 1.2) * loose * (1 - this.slideK);
    const bobX = Math.sin(this.bobT) * 0.012 * bobK;
    const bobY = Math.sin(this.bobT * 2) * 0.009 * bobK;
    const idleY = Math.sin(this.t * 1.7) * 0.0025 * loose;
    const idleX = Math.sin(this.t * 1.1) * 0.0012 * loose;

    // 视角转动时枪稍微滞后，像有重量
    if (this.haveLast && dt > 0) {
      let dy = s.yaw - this.lastYaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      else if (dy < -Math.PI) dy += Math.PI * 2;
      const yawRate = clamp(dy / dt, -9, 9);
      const pitchRate = clamp((s.pitch - this.lastPitch) / dt, -9, 9);
      const k = 1 - Math.exp(-10 * dt);
      this.swayX += (clamp(yawRate * 0.011, -0.055, 0.055) * loose - this.swayX) * k;
      this.swayY += (clamp(-pitchRate * 0.011, -0.04, 0.04) * loose - this.swayY) * k;
    }
    this.lastYaw = s.yaw;
    this.lastPitch = s.pitch;
    this.haveLast = true;

    // 整枪后坐：临界阻尼弹簧，快速顶回来再归位
    const stiff = 220;
    const damp = 2 * Math.sqrt(stiff);
    this.kickV += (-stiff * this.kickZ - damp * this.kickV) * dt;
    this.kickZ += this.kickV * dt;
    this.kickRotV += (-stiff * this.kickRot - damp * this.kickRotV) * dt;
    this.kickRot += this.kickRotV * dt;
    this.kickSide *= Math.exp(-14 * dt);
    const kz = this.kickZ * 0.035;
    const kr = this.kickRot * 0.012;

    // 腰射位置 → 瞄准位置：让 sight 点落在屏幕中心（相机前方 eyeRelief 处）
    const sc = base.s;
    // 瞄准镜：镜筒很粗，贴到眼前会把画面堵成一团黑；举镜过程中只靠近到镜筒后方一段距离，
    // 剩下的交给界面层的镜框遮罩
    const relief = s.scope ? Math.max(w.eyeRelief, 0.16) : w.eyeRelief;
    const adsX = 0;
    const adsY = -sc * w.sight.y - (s.scope ? 0.012 : 0);
    const adsZ = sc * w.sight.z - relief;
    const hipX = base.x;
    const hipY = base.y;
    const hipZ = base.z;

    let px = lerp(hipX, adsX, aimK) + this.swayX + bobX + idleX + this.kickSide;
    let py = lerp(hipY, adsY, aimK) + this.swayY + bobY + idleY;
    let pz = lerp(hipZ, adsZ, aimK) + kz;
    let rx = kr;
    let ry = Math.PI;
    let rz = 0.04 * Math.sin(this.bobT) * this.bobAmp * loose;

    // 举枪（换枪）：从下方抬上来
    py -= 0.34 * raiseK;
    rx -= 0.85 * raiseK;
    // 战术冲刺：枪口朝左上斜举
    px += 0.05 * this.sprintK;
    py -= 0.04 * this.sprintK;
    pz += 0.02 * this.sprintK;
    rx += 0.25 * this.sprintK;
    ry += 0.55 * this.sprintK;
    rz -= 0.5 * this.sprintK;
    // 建造模式：放低
    px -= 0.03 * this.lowerK;
    py -= 0.13 * this.lowerK;
    rx -= 0.28 * this.lowerK;
    // 换弹：枪向内侧倾斜、略微抬起，露出弹匣井
    px -= 0.05 * reloadK;
    py -= 0.04 * reloadK;
    pz += 0.03 * reloadK;
    rx += 0.18 * reloadK;
    ry += 0.25 * reloadK;
    rz += 0.6 * reloadK;
    // 滑铲 / 蹲伏：枪身倾斜
    rz += 0.28 * this.slideK * (1 - aimK) + 0.06 * this.crouchK * (1 - aimK);
    py -= 0.015 * this.crouchK * (1 - aimK);
    // 近战：枪托向左前方挥出去
    px -= 0.12 * meleeK;
    py += 0.02 * meleeK;
    pz -= 0.12 * meleeK;
    ry -= 0.7 * meleeK;
    rz += 0.5 * meleeK;

    this.root.position.set(px, py, pz);
    this.root.scale.setScalar(sc);
    this.root.rotation.set(rx, ry, rz);

    this.cycleT += dt;
    this.animateParts(w, s, dt);

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

    // 双手跟着枪的握点（IK）；换弹时左手去拿弹匣 / 塞子弹，泵动时左手跟着护木
    this.root.updateMatrixWorld(true);
    w.group.localToWorld(this.gripR.copy(w.gripR));
    this.leftHandTarget(w, s);
    w.group.localToWorld(this.gripL.copy(this.tmp));
    this.armR.solve(this.shoulderR, this.gripR, this.poleR);
    this.armL.solve(this.shoulderL, this.gripL, this.poleL);

    this.visible = s.alive;
  }

  /**
   * TACZ 枪：姿势、换弹、开火、走路晃动全由动画决定，这里只补动画里没有的东西——
   * 视角滞后、建造模式放低、近战挥枪、视野变化、火光衰减。
   */
  private updateTacz(dt: number, s: ViewModelState, rig: TaczRig): void {
    this.t += dt;
    this.lowerK += ((s.lowered ? 1 : 0) - this.lowerK) * (1 - Math.exp(-8 * dt));
    this.adsK = ease(clamp(s.ads, 0, 1));
    const aimK = this.adsK;
    const loose = 1 - 0.85 * aimK;
    const meleeK = s.melee >= 0 ? pulse(s.melee, 0.25) : 0;

    this.fovNow = lerp(rig.fov.hip, rig.fov.ads, aimK);
    if (Math.abs(this.camera.fov - this.fovNow) > 0.01 || this.camera.aspect !== this.mainAspect) {
      this.camera.fov = this.fovNow;
      this.camera.aspect = this.mainAspect;
      this.camera.updateProjectionMatrix();
    }

    if (this.haveLast && dt > 0) {
      let dy = s.yaw - this.lastYaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      else if (dy < -Math.PI) dy += Math.PI * 2;
      const yawRate = clamp(dy / dt, -9, 9);
      const pitchRate = clamp((s.pitch - this.lastPitch) / dt, -9, 9);
      const k = 1 - Math.exp(-10 * dt);
      this.swayX += (clamp(yawRate * 0.011, -0.055, 0.055) * loose - this.swayX) * k;
      this.swayY += (clamp(-pitchRate * 0.011, -0.04, 0.04) * loose - this.swayY) * k;
    }
    this.lastYaw = s.yaw;
    this.lastPitch = s.pitch;
    this.haveLast = true;

    // 摄像机空间里的额外变换：先乘上一帧的摄像机动画（TACZ 里手和世界都跟着它转），再叠视角滞后 / 放低 / 近战
    const px = this.swayX * 0.6 - 0.03 * this.lowerK - 0.1 * meleeK;
    const py = this.swayY * 0.6 - 0.12 * this.lowerK + 0.02 * meleeK;
    const pz = -0.1 * meleeK;
    this.preEuler.set(-this.swayY * 2.2 - 0.28 * this.lowerK, this.swayX * 2.2 - 0.6 * meleeK, 0.4 * meleeK);
    this.pre.makeRotationFromQuaternion(rig.cameraAnim);
    this.pre.multiply(this.preRot.makeTranslation(px, py, pz));
    this.pre.multiply(this.preRot.makeRotationFromEuler(this.preEuler));

    rig.update(dt, {
      ads: aimK,
      reload: s.reload,
      mag: s.mag,
      magMax: s.magMax,
      xmag: 0,
      speed: s.speed,
      fwd: s.fwd,
      side: s.side,
      sprinting: s.sprinting,
      sliding: s.sliding,
      busy: s.lowered || s.melee >= 0,
      pre: this.pre,
    });
    this.cameraAnim.copy(rig.cameraAnim);

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = this.flashPeak * clamp(this.flashT / 0.055, 0, 1);
      rig.muzzleLocal(this.flashLight.position);
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    this.visible = s.alive;
  }

  /** 机构动作：套筒 / 拉机柄后坐、泵动、拉栓、转轮、弹链、换弹时弹匣掉出再插回 */
  private animateParts(w: WeaponModel, s: ViewModelState, dt: number): void {
    const P = w.parts;
    const R = w.rest;
    const c = this.cycleT / this.cycleLen;
    // 半自动 / 全自动：开火瞬间后坐，随后复进
    const blow = c < 1 ? (c < 0.2 ? c / 0.2 : Math.max(0, 1 - (c - 0.2) / 0.5)) : 0;
    for (const name of ['slide', 'bolt'] as const) {
      const g = P[name];
      const r = R[name];
      if (!g || !r) continue;
      if (w.action === 'bolt' && name === 'bolt') continue;
      g.position.copy(r.p);
      g.position.z -= w.slideTravel * blow;
    }
    // 打空：手枪套筒停在后方
    if (P.slide && R.slide && w.action === 'semi' && s.reload >= 0 && s.reload < 0.8) P.slide.position.z = R.slide.p.z - w.slideTravel * 0.9;

    // 泵动：开火后 0.1 秒向后拉、再推回去
    if (P.pump && R.pump) {
      const k = c > 0.12 && c < 0.85 ? pulse((c - 0.12) / 0.73, 0.45) : 0;
      P.pump.position.copy(R.pump.p);
      P.pump.position.z -= w.slideTravel * k;
    }
    // 栓动：抬栓（绕枪管轴转）→ 后拉 → 推回 → 压下
    if (P.bolt && R.bolt && w.action === 'bolt') {
      const k = c > 0.15 && c < 0.95 ? (c - 0.15) / 0.8 : -1;
      let lift = 0;
      let back = 0;
      if (k >= 0) {
        lift = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
        back = k < 0.2 || k > 0.8 ? 0 : pulse((k - 0.2) / 0.6, 0.5);
      }
      P.bolt.position.copy(R.bolt.p);
      P.bolt.position.z -= w.slideTravel * back;
      P.bolt.rotation.z = R.bolt.rz + ease(lift) * 1.1;
    }
    // 转轮：每发转 60°
    if (P.drum && R.drum) {
      this.drumA += (this.drumTarget - this.drumA) * (1 - Math.exp(-22 * dt));
      // 换弹：转轮摆出到右侧、快速旋转
      const out = s.reload >= 0 ? pulse(s.reload, 0.15) : 0;
      P.drum.position.copy(R.drum.p);
      P.drum.position.x -= 0.07 * out;
      P.drum.rotation.z = R.drum.rz + this.drumA + (s.reload >= 0 ? s.reload * Math.PI * 4 : 0);
    }
    // 弹链：每发往机匣里拽一节
    if (P.belt && R.belt) {
      this.beltK *= Math.exp(-18 * dt);
      P.belt.position.copy(R.belt.p);
      P.belt.position.y += 0.011 * (1 - this.beltK) - 0.011;
      P.belt.position.x -= 0.004 * (1 - this.beltK) - 0.004;
    }
    // 弹匣：换弹前段掉出去，中段不见，后段插回来
    if (P.mag && R.mag) {
      const r = s.reload;
      let drop = 0;
      if (r >= 0) {
        if (r < 0.3) drop = ease(r / 0.3);
        else if (r < 0.55) drop = 1;
        else if (r < 0.8) drop = 1 - ease((r - 0.55) / 0.25);
      }
      P.mag.visible = !(r >= 0.3 && r < 0.42);
      P.mag.position.copy(R.mag.p);
      P.mag.position.y -= 0.22 * drop;
      P.mag.position.z -= 0.03 * drop;
      P.mag.rotation.x = -0.3 * drop;
    }
  }

  /** 左手目标（枪的局部坐标），写进 this.tmp */
  private leftHandTarget(w: WeaponModel, s: ViewModelState): void {
    const t = this.tmp.copy(w.gripL);
    const r = s.reload;
    if (r < 0) {
      // 泵动时左手跟着护木走
      if (w.parts.pump && w.rest.pump) t.z += w.parts.pump.position.z - w.rest.pump.p.z;
      return;
    }
    if (w.action === 'pump') {
      // 霰弹枪：左手在装弹口和腰间之间往返，一发发塞
      const n = 4;
      const k = (r * n) % 1;
      const reach = pulse(k, 0.5);
      t.set(0.02, -0.04 - 0.1 * reach, 0.13 - 0.05 * reach);
      return;
    }
    const mag = w.parts.mag ?? w.parts.drum;
    if (!mag) return;
    // 去拿弹匣：先到弹匣底部，弹匣掉下去时手到腰间，再带着新弹匣回来
    const k = r < 0.2 ? ease(r / 0.2) : r > 0.85 ? 1 - ease((r - 0.85) / 0.15) : 1;
    const mx = mag.position.x;
    const my = mag.position.y - 0.08;
    const mz = mag.position.z;
    t.set(lerp(t.x, mx, k), lerp(t.y, my, k), lerp(t.z, mz, k));
  }

  dispose(): void {
    this.disposed = true;
    if (this.taczRig) this.scene.remove(this.taczRig.root);
    for (const rig of this.tacz.values()) rig.dispose();
    this.tacz.clear();
    this.onSound = this.onTaczReady = null;
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
    });
  }
}
