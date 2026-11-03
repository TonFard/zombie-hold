import { createAudio, type AudioSystem } from '../audio';
import { isDifficulty, type Difficulty } from '../game/data/difficulty';
import type { Quality } from '../game/data/quality';
import type { WeaponKind } from '../game/data/weapons';
import { FINAL_NIGHT } from '../game/data/waves';
import type { ZombieKind } from '../game/data/zombies';
import { dailyFor, newlyDone, todayKey } from '../game/meta/achievements';
import { applyDaily, applyMeta, applyTraining, sidearmOk, widenMeta } from '../game/meta/loadout';
import { bonusesOf, buyMeta, difficultyUnlocked, medalsFor, settleRun, type RunOutcome } from '../game/meta/progress';
import { RUN_KEY, loadCheckpoint, peekCheckpoint, serialize } from '../game/save/checkpoint';
import { Game, STEP } from '../game/sim';
import { switchWeapon } from '../game/systems/player';
import { chooseCard, continueEndless, nightsSurvived, rerollCards, startRun } from '../game/systems/run';
import { Training } from '../game/systems/training';
import { GameView } from '../render/core/view';
import { buildWeapon } from '../render/weapons';
import { hud, syncHud } from '../ui/hud';
import { toast, ui } from '../ui/store';
import { wireEvents } from './events-wiring';
import { InputController } from './input';
import { Loop } from './loop';
import { loadSave, recordRun, resetOnUpdate, storage, writeSave, type SaveData } from './save';
import { Screens } from './screens';

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

/**
 * 开发调试入口：?night=1 切到夜晚，?demo=horde 持续刷怪，?nopost=1 关闭后期，?quality=low|mid|high 临时指定画质；
 * ?autostart=1 跳过菜单直接开一局（沙盒规则：什么都解锁，不存档）；?lobby=1 直接进大厅；?training=1 直接进训练场；
 * ?continue=1 读检查点继续；?deploy=normal|hard|nightmare 按局外进度出征
 */
function readParams() {
  const q = new URLSearchParams(window.location.search);
  const raw = q.get('quality');
  const quality: Quality | null = raw === 'low' || raw === 'mid' || raw === 'high' ? raw : null;
  const dep = q.get('deploy');
  return {
    night: q.get('night'),
    demo: q.get('demo'),
    nopost: q.get('nopost') === '1',
    autostart: q.get('autostart') === '1',
    lobby: q.get('lobby') === '1',
    training: q.get('training') === '1',
    resume: q.get('continue') === '1',
    deploy: isDifficulty(dep) ? dep : null,
    daily: q.get('daily') === '1',
    sidearm: q.get('sidearm'),
    /** 无头截图用：没有真实鼠标，假装已锁定指针 */
    nolock: q.get('nolock') === '1',
    quality,
  };
}

export function startApp(canvas: HTMLCanvasElement, fxLayer: HTMLElement): App {
  const params = readParams();
  // 每日挑战：同一天固定种子
  const daily = params.daily ? dailyFor(todayKey()) : null;
  const game = new Game(daily ? daily.seed : Date.now() & 0xffff);
  const view = new GameView(canvas, game, fxLayer);
  const input = new InputController(canvas, game);
  // 没有指针锁定能力的环境（或无头测试）直接当作已锁定
  input.assumeLocked = params.nolock || typeof canvas.requestPointerLock !== 'function';
  view.look = input.look;
  view.setNight(params.night !== null ? Number(params.night) : 0.15, true);
  // 新版本：进度全部重置（设置保留），检查点也一起删掉
  const wiped = resetOnUpdate(storage, RUN_KEY);
  const loaded = loadSave(storage);
  ui.save = loaded.save;
  if (wiped) toast('游戏已更新：进度已重置，重新开始（设置保留）');
  else if (loaded.warning) {
    console.warn(loaded.warning);
    toast(loaded.warning, true);
  } else if (loaded.migrated) toast('旧存档已升级：统计和设置都保留了');
  input.sensitivity = ui.save.sensitivity;
  view.setQuality(params.quality ?? ui.save.quality);
  if (params.nopost) view.post.enabled = false;
  const audio = createAudio(game, ui.save.volume, () => input.look.yaw);
  const screens = new Screens(game, input);
  const unwire = wireEvents(game, audio);
  // TACZ 枪：动画音效走采样，加载好的武器停掉合成枪声
  view.viewmodel.onSound = (url, gain) => audio.sample(url, gain);
  view.viewmodel.onTaczReady = (kind, urls) => audio.useSamples(kind, urls);
  input.onInspect = () => view.viewmodel.inspect();

  const save = (next: SaveData): void => {
    ui.save = next;
    writeSave(storage, next);
  };
  /** 这一局是正式的（按局外进度出征 / 读档继续）：会存检查点、结算勋章。沙盒（?autostart）和训练场都不是 */
  let ranked = false;
  /** 本局每种僵尸的击杀（图鉴） */
  let runKills: Record<string, number> = {};
  /** 已经计入存档的挑战数（无尽模式第二次结算时不重复算） */
  let challengesPaid = 0;
  game.events.on('zombieDied', ({ zombie }) => {
    if (!zombie.dummy) runKills[zombie.kind] = (runKills[zombie.kind] ?? 0) + 1;
  });
  let training: Training | null = null;

  const refreshCheckpoint = (): void => {
    const cp = peekCheckpoint(storage.get(RUN_KEY));
    ui.checkpoint = cp && isDifficulty(cp.difficulty) ? { night: cp.night, difficulty: cp.difficulty, savedAt: cp.savedAt, scrap: Math.floor(cp.scrap), hp: Math.ceil(cp.hp), maxHp: cp.maxHp } : null;
  };
  refreshCheckpoint();

  let demoTimer = 0;
  let hudTimer = 0;
  let menuT = 0;
  const timers: number[] = [];
  const disposers: Array<() => void> = [];
  const kinds: ZombieKind[] = ['walker', 'walker', 'walker', 'runner', 'bloater', 'breaker'];
  const later = (ms: number, fn: () => void) => {
    timers.push(window.setTimeout(fn, ms));
  };
  const refreshHud = () => {
    syncHud(game, 0, { locked: input.locked, yaw: input.look.yaw });
    ui.rerolls = game.run.rerollsLeft;
  };

  const loop = new Loop({
    shouldSimulate: () => screens.simulating && !app.paused,
    beforeSimulate: () => {
      if (screens.isPlaying) input.update();
    },
    simulate: (step) => {
      game.update(step);
      training?.update(step);
    },
    afterSimulate: (dt) => {
      audio.update(dt);
      if (params.demo === 'horde') {
        demoTimer -= dt;
        if (demoTimer <= 0 && game.zombies.length < 60) {
          demoTimer = 0.4;
          for (let s = 0; s < game.map.spawns.length; s++) game.spawnAtGate(kinds[Math.floor(Math.random() * kinds.length)] as ZombieKind, s);
        }
      }
    },
    frame: (dt) => {
      // 主菜单 / 大厅：镜头缓缓绕着据点转
      if (ui.screen === 'menu' || ui.screen === 'lobby') {
        menuT += dt;
        view.rig.setView(0.5 + Math.sin(menuT * 0.12) * 2, -1, ui.screen === 'lobby' ? 30 : 36, ui.screen === 'lobby' ? 30 : 36, menuT * 4.5 - 20);
      }
      view.render(dt);
      // 瞄准放大时鼠标灵敏度跟着降低
      input.zoom = view.rig.mode === 'fps' ? view.rig.zoomNow : 1;
      hudTimer += dt;
      if (hudTimer >= 1 / 30) {
        if (training) Object.assign(hud.training, training.stats);
        syncHud(game, hudTimer, { locked: input.locked, yaw: input.look.yaw });
        hudTimer = 0;
      }
    },
  });

  const app: App = {
    game,
    view,
    input,
    audio,
    paused: false,
    step(seconds: number) {
      for (let t = 0; t < seconds / STEP; t++) {
        game.update(STEP);
        training?.update(STEP);
      }
    },
    dev: { buildWeapon },
    dispose() {
      loop.stop();
      for (const t of timers) clearTimeout(t);
      for (const f of disposers) f();
      unwire();
      screens.dispose();
      audio.dispose();
      input.dispose();
      view.dispose();
    },
  };

  /** 进入第一人称，面朝 (tx, tz) */
  const enterPlay = (screen: 'play' | 'training', tx = game.core.x, tz = game.core.z): void => {
    view.rig.enterFps();
    input.setLook(Math.atan2(tx - game.player.x, tz - game.player.z), -0.05);
    view.rig.focus.set(game.player.x, 0, game.player.z);
    screens.set(screen);
    refreshHud();
  };

  /** 换一个 URL 重新加载：每一局都从干净的 Game 开始，不用担心上一局残留的状态 */
  const reload = (q: string): void => {
    window.location.href = `${window.location.pathname}${q}`;
  };

  /** 白天开始时自动存检查点 */
  const checkpoint = (): void => {
    if (!ranked || game.run.phase !== 'day' || game.config.daily) return;
    storage.set(RUN_KEY, JSON.stringify(serialize(game, Date.now())));
    toast(`已自动保存 · 第 ${game.run.night} 天`);
  };
  game.events.on('phase', ({ phase }) => {
    if (phase === 'day') checkpoint();
  });

  /** 一局结束或放弃：结算勋章、更新统计、删除检查点 */
  const settle = (won: boolean, reason: string): void => {
    const outcome: RunOutcome = { difficulty: game.config.difficulty, nights: nightsSurvived(game.run), won: won || game.run.night > FINAL_NIGHT, kills: game.stats.kills, headshotKills: game.stats.headshotKills, challenges: game.stats.challenges };
    // 无尽模式结束是同一局的第二次结算：出征次数不再加一，击杀只加通关以后的部分
    const again = game.run.medalsPaid > 0;
    const [stats0, isBest] = recordRun(ui.save, { won, night: game.run.night, kills: again ? 0 : game.stats.kills, headshotKills: again ? 0 : game.stats.headshotKills, time: game.run.time });
    const stats = again ? { ...stats0, runs: ui.save.runs, wins: ui.save.wins, bestKills: Math.max(ui.save.bestKills, game.stats.kills) } : stats0;
    const none = { nights: 0, bosses: 0, kills: 0, headshots: 0, win: 0, challenges: 0, base: 0, mult: 1, total: 0 };
    const full = ranked ? medalsFor(outcome) : none;
    const owed = { ...full, total: Math.max(0, full.total - game.run.medalsPaid) };
    let meta = stats.meta;
    if (ranked) {
      [meta] = settleRun(stats.meta, outcome);
      // settleRun 按全额加了勋章，把已经付过的减回去
      meta = { ...meta, medals: meta.medals - (full.total - owed.total), medalsEarned: meta.medalsEarned - (full.total - owed.total) };
      game.run.medalsPaid = full.total;
    }
    const medals = owed;
    // 图鉴：本局每种僵尸的击杀；每日挑战：记录今天的最远夜数
    const codex = { kills: { ...ui.save.codex.kills }, done: [...ui.save.codex.done], daily: { ...ui.save.codex.daily }, challenges: ui.save.codex.challenges + game.stats.challenges - challengesPaid };
    challengesPaid = game.stats.challenges;
    for (const [k, n] of Object.entries(runKills)) codex.kills[k as keyof typeof codex.kills] = (codex.kills[k as keyof typeof codex.kills] ?? 0) + n;
    runKills = {};
    if (game.config.daily) codex.daily[game.config.daily] = Math.max(codex.daily[game.config.daily] ?? 0, nightsSurvived(game.run));
    // 成就：达成就给勋章（训练场不算）
    let next = { ...stats, meta, codex };
    if (!game.config.training) {
      const got = newlyDone({ totalKills: next.totalKills, totalHeadshots: next.totalHeadshots, wins: next.wins, bestNight: next.bestNight, clearedHard: meta.cleared.includes('hard'), clearedNightmare: meta.cleared.includes('nightmare'), bestCombo: game.stats.bestCombo, challenges: codex.challenges, codex });
      if (got.length) {
        const bonus = got.reduce((a, x) => a + x.medals, 0);
        next = { ...next, meta: { ...meta, medals: meta.medals + bonus, medalsEarned: meta.medalsEarned + bonus }, codex: { ...codex, done: [...codex.done, ...got.map((x) => x.id)] } };
        ui.achievements = got.map((x) => `${x.name}（+${x.medals}）`);
      } else ui.achievements = [];
    }
    save(next);
    storage.remove(RUN_KEY);
    ui.checkpoint = null;
    ui.result = { won, reason, night: game.run.night, kills: game.stats.kills, headshotKills: game.stats.headshotKills, scrap: game.scrapEarned, time: game.run.time, newBest: isBest, difficulty: outcome.difficulty, medals };
  };

  // ---------------- 界面动作 ----------------
  ui.actions.enterLobby = () => {
    refreshCheckpoint();
    ui.lobbyTab = 'deploy';
    screens.set('lobby');
  };
  ui.actions.deploy = (d: Difficulty, sidearm: string | null) => reload(`?deploy=${d}${sidearm ? `&sidearm=${sidearm}` : ''}`);
  ui.actions.continueRun = () => reload('?continue=1');
  ui.actions.training = () => reload('?training=1');
  ui.actions.daily = () => reload('?daily=1');
  ui.actions.buyMeta = (id) => {
    const [next, r] = buyMeta(ui.save.meta, id);
    if (r === 'ok') {
      save({ ...ui.save, meta: next });
      audio.sfx.uiBuy();
    } else audio.sfx.uiDeny();
  };
  ui.actions.resume = () => screens.set(screens.playScreen);
  ui.actions.restart = () => {
    // 正式局：重新开始 = 放弃这一局（结算）再用同样的设置出征
    if (ranked) {
      if (game.run.phase !== 'won' && game.run.phase !== 'lost') settle(false, 'abandon');
      reload(`?deploy=${game.config.difficulty}${ui.save.meta.lastSidearm ? `&sidearm=${ui.save.meta.lastSidearm}` : ''}`);
    } else reload('?autostart=1');
  };
  ui.actions.abandon = () => {
    if (ranked && game.run.phase !== 'won' && game.run.phase !== 'lost') settle(false, 'abandon');
    reload('?lobby=1');
  };
  ui.actions.toLobby = () => reload('?lobby=1');
  ui.actions.endless = () => {
    if (continueEndless(game)) {
      ui.canEndless = false;
      screens.set('play');
    }
  };
  ui.actions.closeBench = () => screens.set('play');
  ui.actions.pickCard = (id) => {
    if (chooseCard(game, id)) {
      audio.sfx.cardPick();
      screens.set('play');
    }
    refreshHud();
  };
  ui.actions.reroll = () => {
    if (rerollCards(game)) audio.sfx.uiClick();
    else audio.sfx.uiDeny();
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
    save({ ...ui.save, quality: q });
  };
  ui.actions.setSensitivity = (s) => {
    const sensitivity = Math.min(3, Math.max(0.2, s));
    input.sensitivity = sensitivity;
    save({ ...ui.save, sensitivity });
  };
  ui.actions.setVolume = (v) => {
    const volume = Math.min(1, Math.max(0, v));
    audio.setVolume(volume);
    save({ ...ui.save, volume });
  };
  ui.actions.equip = (k) => {
    switchWeapon(game, k as WeaponKind);
    refreshHud();
  };

  // ---------------- 一局里的事件 ----------------
  screens.onBeforeBench = () => {
    game.buildMode = false;
    refreshHud();
  };
  game.events.on('cardsOffered', ({ ids }) => {
    ui.cards = ids;
    ui.rerolls = game.run.rerollsLeft;
    later(1500, () => {
      if (game.run.phase === 'cards' && ui.screen === 'play') screens.set('cards');
    });
  });
  game.events.on('runEnded', ({ won, reason }) => {
    settle(won, reason);
    ui.canEndless = won && ranked && game.config.endless && !game.run.endless;
    later(won ? 1400 : 2000, () => screens.set('result'));
  });

  // ---------------- 从哪里开始 ----------------
  loop.start();
  const bonuses = bonusesOf(ui.save.meta);
  if (params.autostart) {
    // 沙盒：什么都解锁、没有上限；M12 的玩法打开（模拟脚本里默认关）
    game.config = { ...game.config, extras: true, endless: true };
    startRun(game);
    enterPlay('play');
  } else if (params.training) {
    applyTraining(game, bonuses);
    training = new Training(game);
    training.start();
    ui.inTraining = true;
    view.setNight(0, true);
    const onH = (e: KeyboardEvent): void => {
      if (e.code === 'KeyH' && !e.repeat && ui.screen === 'training') ui.dropHint = !ui.dropHint;
    };
    window.addEventListener('keydown', onH);
    disposers.push(() => window.removeEventListener('keydown', onH));
    enterPlay('training', game.player.x + 10, game.player.z);
  } else if (params.resume) {
    const why = loadCheckpoint(game, storage.get(RUN_KEY));
    if (why) {
      console.warn(`检查点读取失败：${why}`);
      storage.remove(RUN_KEY);
      toast(`存档无法继续（${why}），已删除`, true);
      ui.actions.enterLobby();
    } else {
      // 存档之后在大厅新买的解锁 / 上限，读档继续时也生效
      widenMeta(game, bonuses);
      ranked = true;
      enterPlay('play');
      toast(`继续第 ${game.run.night} 天`);
    }
  } else if (params.deploy) {
    const d = difficultyUnlocked(ui.save.meta, params.deploy) ? params.deploy : 'normal';
    const side = sidearmOk(bonuses, params.sidearm) ? params.sidearm : null;
    save({ ...ui.save, meta: { ...ui.save.meta, lastDifficulty: d, lastSidearm: side } });
    // 开一局新的会覆盖旧检查点：旧的那一局按已经撑过的夜数结算
    const old = peekCheckpoint(storage.get(RUN_KEY));
    if (old && isDifficulty(old.difficulty)) {
      const nights = old.phase === 'cards' ? old.night : old.night - 1;
      const [meta] = settleRun(ui.save.meta, { difficulty: old.difficulty, nights, won: false, kills: old.kills, headshotKills: old.headshotKills });
      save({ ...ui.save, meta });
      storage.remove(RUN_KEY);
    }
    ranked = true;
    applyMeta(game, bonuses, { difficulty: d, sidearm: side });
    startRun(game);
    enterPlay('play');
  } else if (daily) {
    // 每日挑战：算正式局（结算勋章、记录成绩），但不存检查点
    ranked = true;
    applyDaily(game, daily);
    startRun(game);
    enterPlay('play');
    toast(`每日挑战 ${daily.key}`);
  } else if (params.lobby) {
    ui.actions.enterLobby();
  }
  if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
  return app;
}
