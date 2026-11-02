import { PerspectiveCamera, Vector3 } from 'three';
import { clamp } from '../game/core/math';
import { GRID_W } from '../game/world/grid';

/** 斜俯视相机：跟随目标，带前瞻、缩放和屏幕震动 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(38, 1, 0.5, 400);
  /** 平滑后的注视点 */
  readonly focus = new Vector3();
  private readonly goal = new Vector3();
  private shake = 0;

  pitch = (58 * Math.PI) / 180;
  yaw = 0;
  distance = 25;
  private zoomTarget = 1;
  private zoom = 1;

  /** 调试 / 截图用：为 true 时不再跟随，完全由 setView 控制 */
  free = false;

  setGoal(x: number, z: number, lookX = 0, lookZ = 0): void {
    const lim = GRID_W / 2 - 6;
    this.goal.set(clamp(x + lookX, -lim, lim), 0, clamp(z + lookZ, -lim, lim));
  }

  setZoom(z: number): void {
    this.zoomTarget = z;
  }

  addShake(a: number): void {
    this.shake = Math.min(1, this.shake + a);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 直接指定视角（截图和调试用） */
  setView(x: number, z: number, distance: number, pitchDeg: number, yawDeg = 0): void {
    this.free = true;
    this.focus.set(x, 0, z);
    this.goal.copy(this.focus);
    this.distance = distance;
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.yaw = (yawDeg * Math.PI) / 180;
    this.zoom = this.zoomTarget = 1;
    this.apply(0);
  }

  update(dt: number): void {
    if (!this.free) {
      const k = 1 - Math.exp(-8 * dt);
      this.focus.lerp(this.goal, k);
      this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-5 * dt));
    }
    this.apply(dt);
  }

  private apply(dt: number): void {
    const d = this.distance * this.zoom;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * d * cp,
      this.focus.y + d * sp,
      this.focus.z + Math.cos(this.yaw) * d * cp,
    );
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.camera.lookAt(this.focus);
  }
}
