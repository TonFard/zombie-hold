import { PerspectiveCamera, Vector3 } from 'three';
import { clamp } from '../game/core/math';

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

  updateFps(dt: number, s: FpsState): void {
    this.focus.set(s.x, 0, s.z);

    // 步伐起伏：速度越快幅度越大，停下时平滑回零
    const target = s.alive ? Math.min(1.4, s.speed / 3.4) * (s.sprinting ? 1.35 : 1) : 0;
    this.bobAmp += (target - this.bobAmp) * (1 - Math.exp(-10 * dt));
    this.bobT += dt * s.speed * 1.7;
    const bobY = Math.sin(this.bobT * 2) * 0.028 * this.bobAmp;
    const bobX = Math.sin(this.bobT) * 0.02 * this.bobAmp;
    const bobRoll = Math.sin(this.bobT) * 0.006 * this.bobAmp;

    // 视野：冲刺时拉宽一点
    const wantFov = FPS_FOV + (s.sprinting && s.speed > 1 ? 7 : 0);
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-7 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.02) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // 死亡：眼睛落到地面附近，头歪向一侧
    const wantH = s.alive ? EYE_HEIGHT : 0.32;
    this.height += (wantH - this.height) * (1 - Math.exp(-(s.alive ? 12 : 3.5) * dt));
    const wantRoll = s.alive ? 0 : 1.25;
    this.roll += (wantRoll - this.roll) * (1 - Math.exp(-3 * dt));

    this.kickPitch *= Math.exp(-9 * dt);

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
    this.camera.position.set(s.x + rx * bobX + jx, this.height + bobY + jy, s.z + rz * bobX + jz);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(clamp(s.pitch + this.kickPitch, -1.5, 1.5), s.yaw + Math.PI, this.roll + bobRoll + jr);
  }
}
