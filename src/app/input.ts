import { clamp } from '../game/core/math';
import { BUILD_RANGE } from '../game/data/structures';
import type { Game } from '../game/sim';
import { HALF_H, HALF_W } from '../game/world/grid';
import { EYE_HEIGHT, type Look } from '../render/cameraRig';

/** 非建造时，瞄准点放在正前方这么远（只用来给逻辑层一个方向） */
const AIM_FAR = 40;
const MAX_PITCH = 1.45;
/** 鼠标每像素转多少弧度（灵敏度 1.0 时） */
const RAD_PER_PX = 0.0022;
/** 建造模式下，视线最多往前找多远 */
const BUILD_SCAN = BUILD_RANGE + 6;

/**
 * 第一人称键鼠输入：鼠标转视角（指针锁定），WASD 相对于朝向移动，
 * 准星射线决定瞄准方向；建造模式下准星指到的格子就是光标。
 */
export class InputController {
  readonly look: Look = { yaw: 0, pitch: 0 };
  /** 灵敏度倍率 */
  sensitivity = 1;
  enabled = true;
  /** 开发 / 无头截图用：假装已经锁定了指针 */
  assumeLocked = false;

  private readonly keys = new Set<string>();
  private mouseDown = false;
  private rightDown = false;

  get locked(): boolean {
    return this.assumeLocked || document.pointerLockElement === this.canvas;
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    const g = this.game.input;
    if (!this.enabled) return;
    if (e.code === 'KeyR') g.reload = true;
    if (e.code === 'KeyB') g.toggleBuild = true;
    if (e.code === 'KeyE') g.use = true;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') g.confirm = true;
    if (e.code >= 'Digit1' && e.code <= 'Digit5') g.select = Number(e.code.slice(5));
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onMove = (e: MouseEvent) => {
    if (!this.enabled || !this.locked) return;
    this.turn(e.movementX, e.movementY);
  };
  private readonly onDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    // 还没锁定时，第一下点击只负责锁定，不开火
    if (!this.locked) {
      this.requestLock();
      return;
    }
    if (e.button === 0) this.mouseDown = true;
    if (e.button === 2) this.rightDown = true;
  };
  private readonly onUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.rightDown = false;
  };
  private readonly onBlur = () => {
    this.keys.clear();
    this.mouseDown = false;
    this.rightDown = false;
  };
  private readonly onContext = (e: Event) => e.preventDefault();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly game: Game,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('contextmenu', this.onContext);
  }

  /** 转动视角（像素）。鼠标事件和测试都走这里 */
  turn(dx: number, dy: number): void {
    const k = RAD_PER_PX * this.sensitivity;
    const l = this.look;
    l.yaw -= clamp(dx, -150, 150) * k;
    if (l.yaw > Math.PI) l.yaw -= Math.PI * 2;
    else if (l.yaw < -Math.PI) l.yaw += Math.PI * 2;
    l.pitch = clamp(l.pitch - clamp(dy, -150, 150) * k, -MAX_PITCH, MAX_PITCH);
  }

  setLook(yaw: number, pitch: number): void {
    this.look.yaw = yaw;
    this.look.pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  }

  requestLock(): void {
    if (this.locked || !this.canvas.requestPointerLock) return;
    // 新版浏览器返回 Promise，被拒绝时（例如刚按过 Esc）静默忽略，等玩家再点一下
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => undefined);
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** 每帧调用一次，把当前输入写进 game.input */
  update(): void {
    const g = this.game.input;
    if (!this.enabled) {
      g.moveX = g.moveZ = 0;
      g.fire = false;
      g.sprint = false;
      g.reload = false;
      g.select = 0;
      g.use = false;
      g.toggleBuild = false;
      g.sell = false;
      g.confirm = false;
      return;
    }
    const k = this.keys;
    const fw = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const st = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    // 前方 = (sin yaw, cos yaw)，右方 = (-cos yaw, sin yaw)
    const sy = Math.sin(this.look.yaw);
    const cy = Math.cos(this.look.yaw);
    g.moveX = sy * fw - cy * st;
    g.moveZ = cy * fw + sy * st;
    g.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const locked = this.locked;
    g.fire = this.mouseDown && locked;
    g.sell = (this.rightDown && locked) || k.has('KeyX');
    this.aim();
  }

  /** 根据视线更新瞄准点：建造模式找准星指到的格子，其他时候放在正前方 */
  private aim(): void {
    const { game } = this;
    const g = game.input;
    const p = game.player;
    const { yaw, pitch } = this.look;
    const cp = Math.cos(pitch);
    const hx = Math.sin(yaw);
    const hz = Math.cos(yaw);
    g.aimX = p.x + hx * AIM_FAR;
    g.aimZ = p.z + hz * AIM_FAR;
    if (!game.buildMode) return;

    // 沿视线一步一步走，直到碰到地面、已有的建筑或墙
    const dx = hx * cp;
    const dy = Math.sin(pitch);
    const dz = hz * cp;
    const grid = game.grid;
    for (let t = 0.25; t < BUILD_SCAN * 2; t += 0.07) {
      const x = p.x + dx * t;
      const y = EYE_HEIGHT + dy * t;
      const z = p.z + dz * t;
      if (Math.hypot(x - p.x, z - p.z) > BUILD_SCAN) break;
      if (y <= 0) {
        g.aimX = x;
        g.aimZ = z;
        return;
      }
      const cx = Math.floor(x + HALF_W);
      const cy2 = Math.floor(z + HALF_H);
      if (!grid.inBounds(cx, cy2)) break;
      const i = grid.idx(cx, cy2);
      const hit = (grid.structure[i] ?? -1) >= 0 ? 1.15 : grid.solid[i] ? 3 : 0;
      if (hit > 0 && y <= hit) {
        g.aimX = cx - HALF_W + 0.5;
        g.aimZ = cy2 - HALF_H + 0.5;
        return;
      }
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('contextmenu', this.onContext);
    this.releaseLock();
  }
}
