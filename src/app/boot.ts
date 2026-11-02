import { Game, STEP } from '../game/sim';
import type { ZombieKind } from '../game/data/zombies';
import { GameView } from '../render/view';
import { buildWeapon } from '../render/models/weapons';
import { syncHud } from '../ui/hud';
import { InputController } from './input';

export interface App {
  game: Game;
  view: GameView;
  input: InputController;
  /** 调试用：为 true 时模拟不前进（画面仍在渲染） */
  paused: boolean;
  /** 调试用：不渲染，直接把模拟快进若干秒 */
  step(seconds: number): void;
  /** 调试用：给截图脚本用的小工具 */
  dev: { buildWeapon: typeof buildWeapon };
  dispose(): void;
}

/** 开发调试入口：URL 参数 ?night=1 切到夜晚，?demo=horde 持续刷怪，?nopost=1 关闭后期 */
function readParams() {
  const q = new URLSearchParams(window.location.search);
  return { night: Number(q.get('night') ?? 0), demo: q.get('demo'), nopost: q.get('nopost') === '1' };
}

export function startApp(canvas: HTMLCanvasElement, fxLayer: HTMLElement): App {
  const params = readParams();
  const game = new Game(Date.now() & 0xffff);
  const view = new GameView(canvas, game, fxLayer);
  const input = new InputController(canvas, game, view.rig.camera);
  view.lighting.setNight(params.night);
  if (params.nopost) view.post.enabled = false;

  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let demoTimer = 0;
  let hudTimer = 0;
  const kinds: ZombieKind[] = ['walker', 'walker', 'walker', 'runner', 'bloater', 'breaker'];

  const app: App = {
    game,
    view,
    input,
    paused: false,
    step(seconds: number) {
      for (let t = 0; t < seconds / STEP; t++) game.update(STEP);
    },
    dev: { buildWeapon },
    dispose() {
      cancelAnimationFrame(raf);
      input.dispose();
      view.dispose();
    },
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!app.paused) {
      input.update();
      acc += dt;
      while (acc >= STEP) {
        game.update(STEP);
        acc -= STEP;
      }
      if (params.demo === 'horde') {
        demoTimer -= dt;
        if (demoTimer <= 0 && game.zombies.length < 60) {
          demoTimer = 0.4;
          for (let s = 0; s < game.map.spawns.length; s++) game.spawnAtGate(kinds[Math.floor(Math.random() * kinds.length)] as ZombieKind, s);
        }
      }
    }
    view.render(dt);
    hudTimer += dt;
    if (hudTimer >= 1 / 30) {
      syncHud(game, hudTimer, { x: input.px, y: input.py, visible: input.hasCursor });
      hudTimer = 0;
    }
  };
  raf = requestAnimationFrame(frame);

  if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
  return app;
}
