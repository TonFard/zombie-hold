import { createAudio, type AudioSystem } from '../audio';
import { Game, STEP } from '../game/sim';
import type { WeaponKind } from '../game/data/weapons';
import type { ZombieKind } from '../game/data/zombies';
import { switchWeapon } from '../game/systems/player';
import { chooseCard, startRun } from '../game/systems/run';
import { buildWeapon } from '../render/models/weapons';
import { GameView, type Quality } from '../render/view';
import { hud, syncHud } from '../ui/hud';
import { ui, type Screen } from '../ui/store';
import { InputController } from './input';
import { loadSave, recordRun, writeSave } from './save';

export interface App {
  game: Game;
  view: GameView;
  input: InputController;
  audio: AudioSystem;
  /** 调试用：为 true 时模拟不前进（画面仍在渲染） */
  paused: boolean;
  /** 调试用：不渲染，直接把模拟快进若干秒 */
  step(seconds: number): void;
  /** 调试用：给截图脚本用的小工具 */
  dev: { buildWeapon: typeof buildWeapon };
  dispose(): void;
}

/** 开发调试入口：?night=1 切到夜晚，?demo=horde 持续刷怪，?nopost=1 关闭后期，?autostart=1 跳过主菜单，?quality=low|mid|high 临时指定画质 */
function readParams() {
  const q = new URLSearchParams(window.location.search);
  const raw = q.get('quality');
  const quality: Quality | null = raw === 'low' || raw === 'mid' || raw === 'high' ? raw : null;
  return {
    night: q.get('night'),
    demo: q.get('demo'),
    nopost: q.get('nopost') === '1',
    autostart: q.get('autostart') === '1',
    /** 无头截图用：没有真实鼠标，假装已锁定指针 */
    nolock: q.get('nolock') === '1',
    quality,
  };
}

export function startApp(canvas: HTMLCanvasElement, fxLayer: HTMLElement): App {
  const params = readParams();
  const game = new Game(Date.now() & 0xffff);
  const view = new GameView(canvas, game, fxLayer);
  const input = new InputController(canvas, game);
  // 没有指针锁定能力的环境（或无头测试）直接当作已锁定
  input.assumeLocked = params.nolock || typeof canvas.requestPointerLock !== 'function';
  view.look = input.look;
  view.setNight(params.night !== null ? Number(params.night) : 0.15, true);
  ui.save = loadSave();
  input.sensitivity = ui.save.sensitivity;
  view.setQuality(params.quality ?? ui.save.quality);
  if (params.nopost) view.post.enabled = false;
  const audio = createAudio(game, ui.save.volume, () => input.look.yaw);

  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let demoTimer = 0;
  let hudTimer = 0;
  let menuT = 0;
  const timers: number[] = [];
  const kinds: ZombieKind[] = ['walker', 'walker', 'walker', 'runner', 'bloater', 'breaker'];

  const app: App = {
    game,
    view,
    input,
    audio,
    paused: false,
    step(seconds: number) {
      for (let t = 0; t < seconds / STEP; t++) game.update(STEP);
    },
    dev: { buildWeapon },
    dispose() {
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      document.removeEventListener('click', onUiClick);
      audio.dispose();
      input.dispose();
      view.dispose();
    },
  };

  const setScreen = (s: Screen): void => {
    ui.screen = s;
    input.enabled = s === 'play';
    // 回到游戏就锁定鼠标，进入任何菜单就释放，这样才能点按钮。
    // 不是在点击 / 按键里触发时浏览器可能拒绝，那就在画面上提示"点击继续"。
    if (s === 'play') input.requestLock();
    else input.releaseLock();
  };
  const later = (ms: number, fn: () => void) => {
    timers.push(window.setTimeout(fn, ms));
  };
  const refreshHud = () => syncHud(game, 0, { locked: input.locked, yaw: input.look.yaw });

  // ---------------- 界面动作 ----------------
  ui.actions.start = () => {
    startRun(game);
    view.rig.enterFps();
    // 出生时面朝发电机
    input.setLook(Math.atan2(game.core.x - game.player.x, game.core.z - game.player.z), -0.05);
    view.rig.focus.set(game.player.x, 0, game.player.z);
    setScreen('play');
    refreshHud();
  };
  ui.actions.resume = () => setScreen('play');
  ui.actions.restart = () => {
    window.location.href = `${window.location.pathname}?autostart=1`;
  };
  ui.actions.toMenu = () => {
    window.location.href = window.location.pathname;
  };
  ui.actions.closeBench = () => setScreen('play');
  ui.actions.pickCard = (id) => {
    if (chooseCard(game, id)) {
      audio.sfx.cardPick();
      setScreen('play');
    }
    refreshHud();
  };
  ui.actions.buy = (k) => {
    if (game.buyWeapon(k as WeaponKind)) audio.sfx.uiBuy();
    else audio.sfx.uiDeny();
    refreshHud();
  };
  ui.actions.upgrade = (k) => {
    if (game.upgradeWeapon(k as WeaponKind)) audio.sfx.uiBuy();
    else audio.sfx.uiDeny();
    refreshHud();
  };
  ui.actions.setQuality = (q) => {
    view.setQuality(q);
    ui.save = { ...ui.save, quality: q };
    writeSave(ui.save);
  };
  ui.actions.setSensitivity = (s) => {
    const sensitivity = Math.min(3, Math.max(0.2, s));
    input.sensitivity = sensitivity;
    ui.save = { ...ui.save, sensitivity };
    writeSave(ui.save);
  };
  ui.actions.setVolume = (v) => {
    const volume = Math.min(1, Math.max(0, v));
    audio.setVolume(volume);
    ui.save = { ...ui.save, volume };
    writeSave(ui.save);
  };
  ui.actions.equip = (k) => {
    switchWeapon(game, k as WeaponKind);
    refreshHud();
  };

  // ---------------- 事件 ----------------
  // 命中 / 击杀标记、受击方向、发电机受击：逻辑层只发事件，HUD 自己决定怎么显示
  game.events.on('zombieHit', (e) => {
    hud.hit = 1;
    hud.hitCrit = e.crit;
  });
  game.events.on('zombieDied', () => {
    hud.kill = 1;
  });
  game.events.on('zombieAttack', ({ zombie, target }) => {
    if (target !== 'player') return;
    const p = game.player;
    // 方位由 syncHud 每次按当前视线重算
    hud.hurtMarks.push({ a: 0, world: Math.atan2(zombie.x - p.x, zombie.z - p.z), life: 1 });
    if (hud.hurtMarks.length > 6) hud.hurtMarks.shift();
  });
  game.events.on('coreDamaged', () => {
    hud.coreHurt = 1;
  });
  game.events.on('banner', (b) => {
    ui.banner = { text: b.text, sub: b.sub, id: ui.banner.id + 1 };
  });
  game.events.on('cardsOffered', ({ ids }) => {
    ui.cards = ids;
    later(1500, () => {
      if (game.run.phase === 'cards' && ui.screen === 'play') setScreen('cards');
    });
  });
  game.events.on('runEnded', ({ won, reason }) => {
    const summary = { won, night: game.run.night, kills: game.stats.kills, time: game.run.time };
    const [next, isBest] = recordRun(ui.save, summary);
    ui.save = next;
    writeSave(next);
    ui.result = { won, reason, night: game.run.night, kills: game.stats.kills, scrap: game.scrapEarned, time: game.run.time, newBest: isBest };
    later(won ? 1400 : 2000, () => setScreen('result'));
  });

  // ---------------- 键盘：暂停、工坊 ----------------
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      if (ui.screen === 'play') setScreen('pause');
      else if (ui.screen === 'pause' || ui.screen === 'bench') setScreen('play');
    } else if (e.code === 'KeyF') {
      if (ui.screen === 'bench') setScreen('play');
      else if (ui.screen === 'play' && game.run.phase === 'day' && hud.benchNear) {
        game.buildMode = false;
        refreshHud();
        setScreen('bench');
      }
    }
  };
  const onBlur = (): void => {
    if (ui.screen === 'play' && game.run.phase !== 'menu') setScreen('pause');
  };
  // 玩家按 Esc 时浏览器会自己退出指针锁定（页面收不到这次按键），这里把它当作"暂停"
  const onLockChange = (): void => {
    if (!input.locked && ui.screen === 'play' && game.run.phase !== 'menu') setScreen('pause');
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);

  // ---------------- 音频 ----------------
  // 浏览器要求在用户手势里才能创建 / 恢复 AudioContext
  const onGesture = (): void => audio.unlock();
  // 买卖和选卡有自己的声音，其余按钮统一用点击声
  const onUiClick = (e: MouseEvent): void => {
    const el = (e.target as Element | null)?.closest('button');
    if (el && !el.matches('.buy, .up, .card')) audio.sfx.uiClick();
  };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
  document.addEventListener('click', onUiClick);

  // ---------------- 主循环 ----------------
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // rAF 给的时间戳可能早于初始化结束时的 performance.now()（初始化很慢时差好几秒），
    // 不夹住下限的话 dt 是负数，模拟会被一个很大的负欠账卡住好几秒
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    // 在游戏里但鼠标还没锁定（刚恢复、锁定被浏览器拒绝）时，等玩家点一下再继续，不让僵尸白打人
    const simulating = (ui.screen === 'menu' || (ui.screen === 'play' && input.locked)) && !app.paused;
    if (simulating) {
      if (ui.screen === 'play') input.update();
      acc += dt;
      while (acc >= STEP) {
        game.update(STEP);
        acc -= STEP;
      }
      audio.update(dt);
      if (params.demo === 'horde') {
        demoTimer -= dt;
        if (demoTimer <= 0 && game.zombies.length < 60) {
          demoTimer = 0.4;
          for (let s = 0; s < game.map.spawns.length; s++) game.spawnAtGate(kinds[Math.floor(Math.random() * kinds.length)] as ZombieKind, s);
        }
      }
    }
    // 主菜单：镜头缓缓绕着据点转
    if (ui.screen === 'menu') {
      menuT += dt;
      view.rig.setView(0.5 + Math.sin(menuT * 0.12) * 2, -1, 36, 36, menuT * 4.5 - 20);
    }
    view.render(dt);
    hudTimer += dt;
    if (hudTimer >= 1 / 30) {
      syncHud(game, hudTimer, { locked: input.locked, yaw: input.look.yaw });
      hudTimer = 0;
    }
  };
  raf = requestAnimationFrame(frame);

  if (params.autostart) ui.actions.start();
  if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
  return app;
}
