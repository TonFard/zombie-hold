import { clamp } from '../game/core/math';
import { BUILD_RANGE } from '../game/data/structures';
import type { Game } from '../game/sim';
import { HALF_H, HALF_W } from '../game/world/grid';
import type { Look } from '../render/core/cameraRig';

/** 非建造时，瞄准点放在正前方这么远（只用来给逻辑层一个方向） */
const AIM_FAR = 40;
const MAX_PITCH = 1.45;
/** 单个鼠标事件超过这么多像素就当成假位移丢掉 */
const SPIKE = 220;
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
  /** 由界面状态机打开（进入一局 / 训练场）；菜单和大厅里关着，点按钮不会锁定鼠标 */
  enabled = false;
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
    // F：开关建造模式；E：交互（工坊由应用层处理，其余时候修理）；V：近战
    if (e.code === 'KeyF') g.toggleBuild = true;
    if (e.code === 'KeyE' && !this.onInteract?.()) g.use = true;
    if (e.code === 'KeyV') g.melee = true;
    // I：检视武器（纯表现，逻辑层不知道）
    if (e.code === 'KeyI') this.onInspect?.();
    if (e.code === 'KeyG') g.grenade = true;
    if (e.code === 'KeyQ') g.pulse = true;
    if (e.code === 'KeyT') g.flashlight = !g.flashlight;
    // B：切换手雷种类（爆炸 / 燃烧）
    if (e.code === 'KeyB') this.game.hz.useFire = !this.game.hz.useFire;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') g.confirm = true;
    if (e.code >= 'Digit1' && e.code <= 'Digit7') g.select = Number(e.code.slice(5));
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  /** E 键先问应用层要不要处理（例如打开工坊），返回 true 就不再当成修理 */
  onInteract: (() => boolean) | null = null;
  onInspect: (() => void) | null = null;
  /** 刚进入指针锁定后丢掉的事件数（第一下常常带着锁定前的整段位移） */
  private skipMoves = 0;
  private readonly onMove = (e: MouseEvent) => {
    if (!this.enabled || !this.locked) return;
    if (this.skipMoves > 0) {
      this.skipMoves--;
      return;
    }
    // Windows 上的 Chromium 在指针锁定时偶尔会报一个几百像素的假位移，镜头会猛地一甩：
    // 正常手速下一个事件很少超过 120 像素，超过 SPIKE 的整个丢掉，而不是截断后照样转
    if (Math.abs(e.movementX) > SPIKE || Math.abs(e.movementY) > SPIKE) return;
    this.turn(e.movementX, e.movementY);
  };
  private readonly onLockChange = () => {
    if (document.pointerLockElement !== this.canvas) return;
    this.skipMoves = 2;
    // 锁定请求是异步的：如果完成时已经回到菜单 / 大厅，马上释放，免得光标消失
    if (!this.enabled) document.exitPointerLock();
  };
  private readonly onDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    // 还没锁定时，第一下点击只负责锁定，不开火；只有点在画面上才锁（点界面按钮不锁）
    if (!this.locked) {
      if (e.target === this.canvas) this.requestLock();
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
  /** 滚轮：切换随身的两把枪（建造模式下切建筑）。触控板一次滚动会连发很多事件，限制一下频率 */
  private wheelAt = 0;
  private readonly onWheel = (e: WheelEvent) => {
    if (!this.enabled || !this.locked || e.deltaY === 0) return;
    const now = performance.now();
    if (now - this.wheelAt < 150) return;
    this.wheelAt = now;
    this.game.input.cycle = e.deltaY > 0 ? 1 : -1;
  };

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
    window.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  /** 转动视角（像素）。鼠标事件和测试都走这里 */
  private pullDown = 0;

  turn(dx: number, dy: number): void {
    const k = (RAD_PER_PX * this.sensitivity) / Math.max(1, this.zoom * 0.85);
    const l = this.look;
    if (dy > 0) this.pullDown += clamp(dy, 0, 150) * k;
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
    // 优先要原始鼠标输入（unadjustedMovement）：绕开系统的指针加速，也能避开 Windows 上的跳变；
    // 不支持就退回普通锁定。被拒绝时（例如刚按过 Esc）静默忽略，等玩家再点一下
    // 必须在点击事件里同步调用，浏览器才认这是用户手势
    const c = this.canvas as HTMLCanvasElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    const plain = (): void => void Promise.resolve(c.requestPointerLock()).catch(() => undefined);
    try {
      const r = c.requestPointerLock({ unadjustedMovement: true });
      if (r instanceof Promise) r.catch((err: unknown) => ((err as { name?: string } | null)?.name === 'NotSupportedError' ? plain() : undefined));
    } catch {
      plain();
    }
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
      g.cycle = 0;
      g.use = false;
      g.toggleBuild = false;
      g.sell = false;
      g.confirm = false;
      g.melee = false;
      g.crouch = false;
      g.ads = false;
      return;
    }
    this.absorbKick();
    const k = this.keys;
    const fw = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const st = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    // 前方 = (sin yaw, cos yaw)，右方 = (-cos yaw, sin yaw)
    const sy = Math.sin(this.look.yaw);
    const cy = Math.cos(this.look.yaw);
    g.moveX = sy * fw - cy * st;
    g.moveZ = cy * fw + sy * st;
    g.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    // 蹲：C（不用 Ctrl，Ctrl+W 会直接关掉浏览器标签页）
    g.crouch = k.has('KeyC');
    const locked = this.locked;
    g.fire = this.mouseDown && locked;
    // 右键：建造模式下是拆除，其他时候是瞄准
    g.sell = (this.rightDown && locked && this.game.buildMode) || k.has('KeyX');
    g.ads = this.rightDown && locked && !this.game.buildMode;
    g.aimPitch = this.look.pitch;
    this.aim();
  }

  /** 瞄准时灵敏度随视野缩小（放大 3.5 倍时转得慢 3.5 倍左右，准星下的东西移动速度不变） */
  zoom = 1;

  /** 后坐力把视线抬高后，玩家往下压枪就是在抵消它：从鼠标的俯仰里扣掉，避免回落时视线掉到原来的下面 */
  absorbKick(): void {
    const p = this.game.player;
    const l = this.look;
    if (p.kickPitch > 0 && this.pullDown > 0) {
      const take = Math.min(p.kickPitch, this.pullDown);
      p.kickPitch -= take;
      l.pitch += take;
    }
    this.pullDown = 0;
  }

  /** 根据视线更新瞄准点：建造模式找准星指到的格子，其他时候放在正前方 */
  private aim(): void {
    const { game } = this;
    const g = game.input;
    const p = game.player;
    const yaw = this.look.yaw;
    const pitch = this.look.pitch + p.kickPitch;
    const eye = p.eye;
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
      const y = eye + dy * t;
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
      const hit = (grid.structure[i] ?? -1) >= 0 ? 1.15 : grid.solid[i] ? grid.height[i] || 3 : 0;
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
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('wheel', this.onWheel);
    this.releaseLock();
  }
}
