import { Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { Game } from '../game/sim';

/** 键鼠输入：把按键和鼠标位置翻译成 game.input。鼠标射线打在胸口高度的平面上，这样指着僵尸身体就是瞄准它 */
export class InputController {
  private readonly keys = new Set<string>();
  private mouse = new Vector2(0, 0);
  private mouseDown = false;
  private rightDown = false;
  private inside = false;
  private readonly ray = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), -1.0);
  private readonly hit = new Vector3();
  /** 屏幕上的鼠标像素位置（准星用） */
  px = 0;
  py = 0;
  enabled = true;

  get hasCursor(): boolean {
    return this.inside;
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    const g = this.game.input;
    if (!this.enabled) return;
    if (e.code === 'KeyR') g.reload = true;
    if (e.code === 'KeyB') g.toggleBuild = true;
    if (e.code === 'KeyE') g.use = true;
    if (e.code >= 'Digit1' && e.code <= 'Digit5') g.select = Number(e.code.slice(5));
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onMove = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.px = e.clientX - r.left;
    this.py = e.clientY - r.top;
    this.mouse.set((this.px / r.width) * 2 - 1, -(this.py / r.height) * 2 + 1);
    this.inside = true;
  };
  private readonly onDown = (e: MouseEvent) => {
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
    private readonly camera: PerspectiveCamera,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('contextmenu', this.onContext);
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
      return;
    }
    const k = this.keys;
    g.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    g.moveZ = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    g.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    g.fire = this.mouseDown && this.inside;
    g.sell = (this.rightDown && this.inside) || k.has('KeyX');
    if (this.inside) {
      this.ray.setFromCamera(this.mouse, this.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        g.aimX = this.hit.x;
        g.aimZ = this.hit.z;
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
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }
}
