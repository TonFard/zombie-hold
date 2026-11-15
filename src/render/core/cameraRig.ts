import { PerspectiveCamera, Vector3 } from 'three';
import { clamp } from '../../game/core/math';

export type RigMode = 'orbit' | 'fps';

/** 视角：yaw 绕 Y（0 = 面向 +Z），pitch 抬头为正。由输入层写入，渲染层读取 */
export interface Look {
  yaw: number;
  pitch: number;
}

/** 眼睛离地高度（米） */
export const EYE_HEIGHT = 1.62;
const FPS_FOV = 74;
const ORBIT_FOV = 38;

export interface FpsState {
  x: number;
  z: number;
  /** 绕 Y 的朝向，0 = 面向 +Z */
  yaw: number;
  /** 抬头为正 */
  pitch: number;
  /** 水平移动速度（米/秒） */
  speed: number;
  sprinting: boolean;
  alive: boolean;
  /** 眼睛高度（蹲下变低） */
  eye: number;
  /** 脚离地多高（对战里跳起来、站在箱子上）；不给 = 0 */
  air?: number;
  /** 瞄准进度 0–1 和这把武器的放大倍数 */
  ads: number;
  zoom: number;
  /** 后坐力造成的水平偏移（弧度，会真实影响弹着点） */
  kickYaw: number;
  /** 滑铲中：镜头压低并向一侧倾斜 */
  sliding: boolean;
}

/**
 * 相机：第一人称（游戏中）和环绕（主菜单背景、调试截图）两种模式。
 * 第一人称带步伐起伏、冲刺时视野变宽、后坐力上抬、屏幕震动和死亡倒地。
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(ORBIT_FOV, 1, 0.5, 400);
  /** 玩家脚下的位置，光照 / 阴影跟随它 */
  readonly focus = new Vector3();
  mode: RigMode = 'orbit';

  // ---- 环绕模式 ----
  pitch = (36 * Math.PI) / 180;
  yaw = 0;
  distance = 36;

  // ---- 第一人称状态 ----
  private shake = 0;
  private kickPitch = 0;
  private bobT = 0;
  private bobAmp = 0;
  private fov = FPS_FOV;
  private height = EYE_HEIGHT;
  private roll = 0;
  private slideRoll = 0;
  /** 当前的放大倍数（输入层用它缩放灵敏度） */
  zoomNow = 1;
  // ---- 观战（越肩镜头）----
  private chaseYaw = 0;
  private chasePitch = 0;
  private chaseBack = 0;
  private chaseY = 0;
  // ---- 跳：现在脚离地多高、上一帧的竖直速度、落地时镜头往下一顿 ----
  private air = 0;
  private airV = 0;
  private landDip = 0;

  /** 兼容旧代码：环绕模式即"自由镜头" */
  get free(): boolean {
    return this.mode === 'orbit';
  }

  /** 进入第一人称 */
  enterFps(): void {
    this.mode = 'fps';
    this.camera.near = 0.05;
    this.camera.far = 300;
    this.fov = FPS_FOV;
    this.height = EYE_HEIGHT;
    this.roll = 0;
    this.kickPitch = 0;
    this.air = this.airV = this.landDip = 0;
    this.camera.fov = FPS_FOV;
    this.camera.updateProjectionMatrix();
  }

  addShake(a: number): void {
    this.shake = Math.min(1, this.shake + a);
  }

  /** 开枪的视觉上抬（弧度）。只影响画面，不影响命中 */
  kick(rad: number): void {
    this.kickPitch = Math.min(0.12, this.kickPitch + rad);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 环绕视角（主菜单背景、调试截图） */
  setView(x: number, z: number, distance: number, pitchDeg: number, yawDeg = 0): void {
    if (this.mode !== 'orbit') {
      this.mode = 'orbit';
      this.camera.near = 0.5;
      this.camera.far = 400;
      this.camera.fov = ORBIT_FOV;
      this.camera.updateProjectionMatrix();
    }
    this.focus.set(x, 0, z);
    this.distance = distance;
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.yaw = (yawDeg * Math.PI) / 180;
    this.camera.rotation.order = 'XYZ';
    const cp = Math.cos(this.pitch);
    this.camera.position.set(x + Math.sin(this.yaw) * distance * cp, Math.sin(this.pitch) * distance, z + Math.cos(this.yaw) * distance * cp);
    this.camera.lookAt(this.focus);
  }

  /**
   * 观战：跟在一个人身后的越肩镜头（对战里玩家死了以后看队友）。
   * back = 镜头往后拉多远（调用的人已经按墙截短过）；fresh = 刚换了一个人看，镜头直接跳过去不要甩
   */
  updateChase(dt: number, s: { x: number; z: number; y: number; yaw: number; pitch: number; back: number; fresh: boolean }): void {
    this.focus.set(s.x, 0, s.z);
    let turn = s.yaw - this.chaseYaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const k = s.fresh ? 1 : 1 - Math.exp(-9 * dt);
    this.chaseYaw += turn * (s.fresh ? 1 : 1 - Math.exp(-6 * dt));
    this.chasePitch += (s.pitch - this.chasePitch) * k;
    this.chaseBack += (s.back - this.chaseBack) * k;
    // 他跳起来 / 站到箱子上，镜头跟着升
    this.chaseY += (s.y - this.chaseY) * (s.fresh ? 1 : 1 - Math.exp(-12 * dt));
    this.air = this.airV = this.landDip = 0;
    // 回到第一人称时从正常的高度、不歪头开始
    this.roll = 0;
    this.height = EYE_HEIGHT;
    this.zoomNow = 1;
    this.fov = FPS_FOV;
    if (Math.abs(this.camera.fov - FPS_FOV) > 0.02) {
      this.camera.fov = FPS_FOV;
      this.camera.updateProjectionMatrix();
    }
    const fx = Math.sin(this.chaseYaw);
    const fz = Math.cos(this.chaseYaw);
    // 往右肩偏一点（右方向 = (-cos yaw, sin yaw)），贴着墙时镜头拉近、偏移也跟着收
    const side = 0.42 * Math.min(1, this.chaseBack / 1.4);
    this.camera.position.set(s.x - fx * this.chaseBack - fz * side, this.chaseY + 1.68 + 0.14 * this.chaseBack, s.z - fz * this.chaseBack + fx * side);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(clamp(this.chasePitch - 0.1, -1.2, 1.2), this.chaseYaw + Math.PI, 0);
  }

  updateFps(dt: number, s: FpsState): void {
    this.focus.set(s.x, 0, s.z);

    // 步伐起伏：速度越快幅度越大，停下时平滑回零
    const target = s.alive ? Math.min(1.4, s.speed / 3.4) * (s.sprinting ? 1.35 : 1) : 0;
    this.bobAmp += (target - this.bobAmp) * (1 - Math.exp(-10 * dt));
    this.bobT += dt * s.speed * 1.7;
    const bobY = Math.sin(this.bobT * 2) * 0.028 * this.bobAmp;
    const bobX = Math.sin(this.bobT) * 0.02 * this.bobAmp;
    const bobRoll = Math.sin(this.bobT) * 0.006 * this.bobAmp;

    // 视野：冲刺时拉宽一点；瞄准时按倍率缩小（tan 空间里缩放，倍率才是真的倍率）
    const base = FPS_FOV + (s.sprinting && s.speed > 1 ? 7 : 0) + (s.sliding ? 5 : 0);
    const zoom = 1 + (s.zoom - 1) * s.ads;
    const wantFov = (2 * Math.atan(Math.tan((base * Math.PI) / 360) / zoom) * 180) / Math.PI;
    // 瞄准切换用武器自己的举镜速度（ads 本身已经是平滑的），其余变化平滑过渡
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-(s.ads > 0.01 ? 30 : 7) * dt));
    this.zoomNow = Math.tan((FPS_FOV * Math.PI) / 360) / Math.tan((this.fov * Math.PI) / 360);
    // 瞄准时步伐起伏小很多
    this.bobAmp *= 1 - 0.75 * s.ads;
    if (Math.abs(this.camera.fov - this.fov) > 0.02) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // 死亡：眼睛落到地面附近，头歪向一侧
    const wantH = s.alive ? s.eye - (s.sliding ? 0.12 : 0) : 0.32;
    this.height += (wantH - this.height) * (1 - Math.exp(-(s.alive ? 12 : 3.5) * dt));
    const wantRoll = s.alive ? 0 : 1.25;
    this.roll += (wantRoll - this.roll) * (1 - Math.exp(-3 * dt));
    this.slideRoll += ((s.sliding ? 0.07 : 0) - this.slideRoll) * (1 - Math.exp(-10 * dt));

    this.kickPitch *= Math.exp(-9 * dt);

    // 跳 / 站在箱子上：脚离地多高直接加在镜头上（不平滑，不然起跳时镜头慢半拍）；落得快的时候着地往下一顿
    const air = s.air ?? 0;
    if (s.alive) {
      if (dt > 0) {
        const v = (air - this.air) / dt;
        if (this.airV < -2.5 && v > -0.5) this.landDip = Math.min(0.13, -this.airV * 0.016);
        // 换局被挪回出生点那一帧不算（一帧掉了好几米）
        this.airV = v > -14 ? v : 0;
      }
      this.air = air;
    } else this.air *= Math.exp(-5 * dt);
    this.landDip *= Math.exp(-11 * dt);

    let jx = 0;
    let jy = 0;
    let jz = 0;
    let jr = 0;
    if (this.shake > 0.001) {
      const k = this.shake * this.shake;
      jx = (Math.random() - 0.5) * k * 0.18;
      jy = (Math.random() - 0.5) * k * 0.18;
      jz = (Math.random() - 0.5) * k * 0.18;
      jr = (Math.random() - 0.5) * k * 0.05;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }

    // 右方向 = (-cos yaw, sin yaw)
    const rx = -Math.cos(s.yaw);
    const rz = Math.sin(s.yaw);
    this.camera.position.set(s.x + rx * bobX + jx, this.height + this.air - this.landDip + bobY + jy, s.z + rz * bobX + jz);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(clamp(s.pitch + this.kickPitch, -1.5, 1.5), s.yaw + s.kickYaw + Math.PI, this.roll + this.slideRoll + bobRoll + jr);
  }
}
