import { createAudio, type AudioSystem } from '../audio';
import { isDifficulty, type Difficulty } from '../game/data/difficulty';
import type { Quality } from '../game/data/quality';
import { AMMO_LIMITED, WEAPON_ORDER, type WeaponKind } from '../game/data/weapons';
import { FINAL_NIGHT } from '../game/data/waves';
import type { ZombieKind } from '../game/data/zombies';
import { dailyFor, newlyDone, todayKey } from '../game/meta/achievements';
import { applyDaily, applyMeta, applyTraining, configFor, sidearmOk, widenMeta } from '../game/meta/loadout';
import { startTdm } from '../game/systems/tdm';
import { bonusesOf, buyMeta, difficultyUnlocked, medalsFor, settleRun, type RunOutcome } from '../game/meta/progress';
import { RUN_KEY, loadCheckpoint, peekCheckpoint, serialize } from '../game/save/checkpoint';
import { isMapId, type MapId } from '../game/world/maps';
import { chapterUnlocked } from '../game/data/chapters';
import { buyAmmo, buyBench, cloneMeta, gunsFor, lockedGuns, pickGun, suppliesFor, unlockGun } from '../game/meta/progress';
import { GUN_BY_ID } from '../game/data/guns';
import { buildReplay } from '../game/stats/replay';
import { createPreview, weaponIcon } from '../render/weapons/preview';
import { acceptRisk } from '../game/systems/events';
import type { BenchLine } from '../game/data/bench';
import { SAVE_KEY } from '../game/save/schema';
import { Game, STEP } from '../game/sim';
import { chooseCard, continueEndless, nightsSurvived, rerollCards, startRun } from '../game/systems/run';
import { Training } from '../game/systems/training';
import { GameView } from '../render/core/view';
import { buildWeapon } from '../render/weapons';
import { hud, syncHud } from '../ui/hud';
import { toast, ui } from '../ui/store';
import { wireEvents } from './events-wiring';
import { InputController } from './input';
import { Loop } from './loop';
import { loadSave, recordRun, writeSave, type SaveData } from './save';
import { AuthError, CloudStore, clearAuth, signOut, type CloudAuth } from './cloud';
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
  /** 渲染实验面板（?render=1） */
  render: {
    toggle(key: 'ao' | 'grade' | 'decals' | 'vista' | 'contact' | 'shadows', on?: boolean): boolean;
    stats(): { calls: number; tris: number };
    quality(q: 'low' | 'mid' | 'high'): void;
    night(t: number): void;
  };
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
    chapter: q.get('chapter'),
    tdm: q.get('tdm') === '1',
    /** 无头截图用：没有真实鼠标，假装已锁定指针 */
    nolock: q.get('nolock') === '1',
    quality,
  };
}

/**
 * 线上存档：auth 是已经登录的账号，storage 是装着服务器上全部进度的 CloudStore（写入会马上上传）。
 * 登录界面在 App.vue；登录 / 拉取完成后才调用这里
 */
export function startApp(canvas: HTMLCanvasElement, fxLayer: HTMLElement, auth: CloudAuth, storage: CloudStore): App {
  const params = readParams();
  // 每日挑战：同一天固定种子
  const daily = params.daily ? dailyFor(todayKey()) : null;
  // 地图：出征时按 ?chapter=，继续时按检查点里记的章节，其余（菜单 / 大厅背景、训练场、每日挑战）用第一章
  const mapId: MapId = params.tdm ? 'arena' : params.resume ? (peekCheckpoint(storage.get(RUN_KEY))?.chapter ?? 'outpost') : params.deploy && isMapId(params.chapter) ? params.chapter : 'outpost';
  const game = new Game(daily ? daily.seed : Date.now() & 0xffff, mapId);
  const view = new GameView(canvas, game, fxLayer);
  view.onWorldReady = () => {
    ui.worldReady = true;
  };
  if (view.worldReady) ui.worldReady = true;
  // 兜底：机器太慢（或资源下载卡住）时最多等 15 秒，先进游戏，写实地图在后台继续加载
  window.setTimeout(() => {
    ui.worldReady = true;
  }, 15000);
  const input = new InputController(canvas, game);
  // 没有指针锁定能力的环境（或无头测试）直接当作已锁定
  input.assumeLocked = params.nolock || typeof canvas.requestPointerLock !== 'function';
  view.look = input.look;
  view.setNight(params.night !== null ? Number(params.night) : 0.15, true);
  // 进度在服务器上：拉下来的就是全部（旧版本传上去的存档照样读，更新游戏不清进度）
  const loaded = loadSave(storage);
  ui.save = loaded.save;
  if (loaded.warning) {
    console.warn(loaded.warning);
    toast(loaded.warning, true);
  } else if (loaded.migrated) toast('旧存档已升级：统计和设置都保留了');
  input.sensitivity = ui.save.sensitivity;
  view.setQuality(params.quality ?? ui.save.quality);
  if (params.nopost) view.post.enabled = false;
  const audio = createAudio(game, ui.save.volume, () => input.look.yaw);
  for (const [ch, v] of Object.entries(ui.save.mix)) audio.setChannel(ch as keyof typeof ui.save.mix, v);
  const screens = new Screens(game, input);
  const unwire = wireEvents(game, audio);
  // TACZ 枪：动画音效走采样，加载好的武器停掉合成枪声
  view.viewmodel.onSound = (url, gain) => audio.sample(url, gain);
  view.viewmodel.onTaczReady = (_id, urls) => audio.useSamples(urls);
  audio.sampledBy = (kind) => view.viewmodel.hasTacz(game.config.guns[kind]);
  input.onInspect = () => view.viewmodel.inspect();

  // ---------------- 线上存档 ----------------
  ui.cloud.name = auth.name;
  let warned = false;
  storage.onError = (e) => {
    ui.cloud.error = e.message;
    // 登录过期：回到登录界面重新登录（进度都在服务器上，不会丢）
    if (e instanceof AuthError) {
      clearAuth();
      window.location.reload();
      return;
    }
    if (!warned) toast(`进度没保存上：${e.message}，会自动重试`, true);
    warned = true;
  };
  // 断网时每 10 秒重试一次没传上去的进度
  const retry = window.setInterval(() => {
    if (storage.busy) void storage.flush();
  }, 10000);

  const save = (next: SaveData): void => {
    ui.save = next;
    writeSave(storage, next);
  };
  // 新号（服务器上还没有存档）：把新存档写上去
  if (!storage.get(SAVE_KEY)) save(ui.save);
  /** 这一局是正式的（按局外进度出征 / 读档继续）：会存检查点、结算勋章。沙盒（?autostart）和训练场都不是 */
  let ranked = false;
  /** 本局每种僵尸的击杀（图鉴） */
  let runKills: Record<string, number> = {};
  /** 已经计入存档的挑战数（无尽模式第二次结算时不重复算） */
  let challengesPaid = 0;
  /** 无尽模式第二次结算时，熟练度只加通关以后的击杀 */
  let wkPaid: Partial<Record<WeaponKind, number>> = {};
  let whPaid: Partial<Record<WeaponKind, number>> = {};
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
  /** 相机平滑过渡：目标和当前各 5 个分量 [x, z, dist, pitch, yaw] */
  let camCur = [0, 0, 30, 30, 0];
  let camTgt = [...camCur];
  let camSmooth = false; // 第一帧不 lerp，直接跳过去
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
      // 主菜单 / 大厅：镜头缓缓绕着据点转，切换页面时 1.5 秒平滑过渡
      if (ui.screen === 'menu' || ui.screen === 'lobby') {
        menuT += dt;
        if (ui.screen === 'menu') {
          // 标题页：低机位电影镜头，一圈约 90 秒，高度和距离缓慢呼吸；据点偏在画面右侧（左边是菜单）
          const yaw = menuT * 4 - 20;
          const dist = 26 + Math.sin(menuT * 0.07) * 3;
          const pitch = 17 + Math.sin(menuT * 0.11) * 3;
          const r = (yaw * Math.PI) / 180;
          camTgt = [0.5 - Math.cos(r) * 9, -1 + Math.sin(r) * 9, dist, pitch, yaw];
        } else {
          // 大厅：稍高一点的俯视环绕
          camTgt = [0.5 + Math.sin(menuT * 0.12) * 2, -1, 30, 30, menuT * 4.5 - 20];
        }
        // lerp 平滑过渡（~1.5 秒 95% 衰减）
        const k = camSmooth ? 1 - Math.exp(-2.5 * dt) : 1;
        for (let i = 0; i < 5; i++) camCur[i] += (camTgt[i] - camCur[i]) * k;
        camSmooth = true;
        view.rig.setView(camCur[0], camCur[1], camCur[2], camCur[3], camCur[4]);
        // 标题页装饰：发电机灯光微弱呼吸
        if (ui.screen === 'menu') view.menuFlicker(menuT);
      }
      // 黎明选卡：每帧检查，而不是只在 1.5 秒后检查一次。
      // 之前那一刻刚好在暂停 / 指针锁丢了，卡牌界面就永远不出来，游戏卡在"黎明"没有下一天
      if (game.run.phase === 'cards' && ui.screen === 'play' && performance.now() >= cardsAt) screens.set('cards');
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
    render: {
      toggle: (key, on) => view.renderToggle(key, on),
      stats: () => view.renderStats(),
      quality: (q) => view.setQuality(q),
      night: (t) => view.setNight(t, true),
    },
    dispose() {
      window.clearInterval(retry);
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
  // 团队死斗：复活时视角转回出生朝向；比赛结束弹结算
  game.events.on('tdmRespawn', ({ yaw }) => input.setLook(yaw, -0.03));
  game.events.on('tdmOver', ({ winner }) => {
    ui.tdmResult = { winner, score: [...game.tdm.score] as [number, number], kills: game.tdm.playerKills, deaths: game.tdm.playerDeaths };
    later(1800, () => screens.set('result'));
  });
  const enterPlay = (screen: 'play' | 'training', tx = game.core.x, tz = game.core.z): void => {
    view.rig.enterFps();
    input.setLook(Math.atan2(tx - game.player.x, tz - game.player.z), -0.05);
    view.rig.focus.set(game.player.x, 0, game.player.z);
    screens.set(screen);
    refreshHud();
  };

  /** 换一个 URL 重新加载：每一局都从干净的 Game 开始，不用担心上一局残留的状态 */
  /** 换页前先把没传完的进度传上去（最多等 4 秒），不然刚结算的勋章会丢 */
  const reload = (q: string): void => {
    ui.cloud.busy = true;
    void Promise.race([storage.flush(true), new Promise((r) => setTimeout(r, 4000))]).then(() => {
      window.location.href = `${window.location.pathname}${q}`;
    });
  };
  window.addEventListener('beforeunload', () => void storage.flush(true));

  /** 白天开始时自动存检查点 */
  const checkpoint = (): void => {
    if (!ranked || game.run.phase !== 'day' || game.config.daily) return;
    storage.set(RUN_KEY, JSON.stringify(serialize(game, Date.now())));
    toast(`已自动保存 · 第 ${game.run.night} 天`);
  };
  game.events.on('phase', ({ phase }) => {
    if (phase === 'day') checkpoint();
  });

  /** 一局打剩下的子弹放回库存 */
  const returnAmmo = (m: typeof ui.save.meta, g: Game): typeof ui.save.meta => {
    const next = cloneMeta(m);
    for (const k of WEAPON_ORDER) {
      if (k === 'pistol') continue;
      const left = (g.ammo[k] ?? 0) + (g.loadout[k].owned ? g.loadout[k].mag : 0);
      if (left > 0) next.ammo[k] = (next.ammo[k] ?? 0) + left;
    }
    return next;
  };

  /** 一局结束或放弃：结算勋章、更新统计、删除检查点 */
  const settle = (won: boolean, reason: string): void => {
    const plusXp = (a: Record<WeaponKind, number>, b: Record<WeaponKind, number>) => Object.fromEntries(WEAPON_ORDER.map((k) => [k, a[k] + b[k]])) as Record<WeaponKind, number>;
    const again = game.run.medalsPaid > 0;
    const minus = (a: Record<WeaponKind, number>, b: Partial<Record<WeaponKind, number>>) => Object.fromEntries(WEAPON_ORDER.map((k) => [k, Math.max(0, a[k] - (b[k] ?? 0))])) as Record<WeaponKind, number>;
    const outcome: RunOutcome = { difficulty: game.config.difficulty, nights: nightsSurvived(game.run), won: won || game.run.night > FINAL_NIGHT, kills: game.stats.kills, headshotKills: game.stats.headshotKills, challenges: game.stats.challenges, chapter: game.config.chapter, weaponKills: minus(plusXp(game.stats.weaponKills, game.stats.bonusXp), wkPaid), weaponHeads: minus(game.stats.weaponHeads, whPaid), eventSupplies: again ? 0 : game.ev.supplies + game.loot.supplies, migrationNights: game.ev.migrationNights };
    wkPaid = plusXp(game.stats.weaponKills, game.stats.bonusXp);
    whPaid = { ...game.stats.weaponHeads };
    ui.masteryGain = outcome.weaponKills ?? {};
    // 无尽模式结束是同一局的第二次结算：出征次数不再加一，击杀只加通关以后的部分
    const [stats0, isBest] = recordRun(ui.save, { won, night: game.run.night, kills: again ? 0 : game.stats.kills, headshotKills: again ? 0 : game.stats.headshotKills, time: game.run.time });
    const stats = again ? { ...stats0, runs: ui.save.runs, wins: ui.save.wins, bestKills: Math.max(ui.save.bestKills, game.stats.kills) } : stats0;
    const none = { nights: 0, bosses: 0, kills: 0, headshots: 0, win: 0, challenges: 0, events: 0, base: 0, mult: 1, total: 0 };
    const full = ranked ? medalsFor(outcome) : none;
    const owed = { ...full, total: Math.max(0, full.total - game.run.medalsPaid) };
    let meta = stats.meta;
    if (ranked) {
      [meta] = settleRun(stats.meta, outcome);
      // 没打完的子弹（备弹 + 弹匣里的）退回大厅库存；无尽模式第二次结算时已经退过了
      if (game.config.ammo && !again) meta = returnAmmo(meta, game);
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
    ui.result = { supplies: ranked && !again ? suppliesFor(outcome) : 0, won, reason, night: game.run.night, kills: game.stats.kills, headshotKills: game.stats.headshotKills, scrap: game.scrapEarned, time: game.run.time, newBest: isBest, difficulty: outcome.difficulty, medals, replay: buildReplay(game.stats, reason) };
  };

  // ---------------- 界面动作 ----------------
  ui.actions.enterLobby = () => {
    refreshCheckpoint();
    ui.lobbyTab = 'deploy';
    screens.set('lobby');
  };
  ui.actions.deploy = (d: Difficulty, sidearm: string | null, chapter: string) => reload(`?deploy=${d}&chapter=${chapter}${sidearm ? `&sidearm=${sidearm}` : ''}`);
  ui.actions.continueRun = () => reload('?continue=1');
  ui.actions.training = () => reload('?training=1');
  ui.actions.daily = () => reload('?daily=1');
  ui.actions.tdm = () => reload('?tdm=1');
  ui.actions.buyMeta = (id) => {
    const [next, r] = buyMeta(ui.save.meta, id);
    if (r === 'ok') {
      save({ ...ui.save, meta: next });
      audio.sfx.uiBuy();
    } else audio.sfx.uiDeny();
  };
  ui.actions.buyAmmo = (k, packs) => {
    const next = buyAmmo(ui.save.meta, k as WeaponKind, packs);
    if (next) {
      save({ ...ui.save, meta: next });
      audio.sfx.uiBuy();
    } else audio.sfx.uiDeny();
  };
  ui.actions.unlockGun = (id) => {
    const next = unlockGun(ui.save.meta, id);
    if (next) {
      // 解锁以后顺手装上：刚花勋章买的枪，大多是想马上用
      const g = GUN_BY_ID[id];
      save({ ...ui.save, meta: (g && pickGun(next, g.cls, id)) || next });
      audio.sfx.uiBuy();
    } else audio.sfx.uiDeny();
  };
  ui.actions.pickGun = (k, id) => {
    const next = pickGun(ui.save.meta, k as WeaponKind, id);
    if (next) {
      save({ ...ui.save, meta: next });
      audio.sfx.uiBuy();
    } else audio.sfx.uiDeny();
  };
  ui.actions.buyBench = (k, line) => {
    const next = buyBench(ui.save.meta, k as WeaponKind, line as BenchLine);
    if (next) {
      save({ ...ui.save, meta: next });
      audio.sfx.uiBuy();
    } else audio.sfx.uiDeny();
  };
  ui.actions.resume = () => screens.set(screens.playScreen);
  ui.actions.restart = () => {
    // 正式局：重新开始 = 放弃这一局（结算）再用同样的设置出征
    if (ranked) {
      if (game.run.phase !== 'won' && game.run.phase !== 'lost') settle(false, 'abandon');
      reload(`?deploy=${game.config.difficulty}&chapter=${game.config.chapter}${ui.save.meta.lastSidearm ? `&sidearm=${ui.save.meta.lastSidearm}` : ''}`);
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
  ui.gfx.icon = (k, tier = 0) => weaponIcon(k as WeaponKind, tier);
  ui.gfx.preview = (w, h) => {
    const p = createPreview(w, h);
    return { canvas: p.canvas, setWeapon: (k, tier) => p.setWeapon(k as WeaponKind, tier), resize: (w2, h2) => p.resize(w2, h2), dispose: () => p.dispose() };
  };
  ui.actions.testSound = () => {
    // 点按钮本身就是手势：先解锁，再放声音
    audio.unlock();
    audio.test();
    return audio.engine.state;
  };
  ui.actions.setMix = (ch, v) => {
    const k = ch as keyof typeof ui.save.mix;
    const x = Math.min(1, Math.max(0, v));
    audio.setChannel(k, x);
    save({ ...ui.save, mix: { ...ui.save.mix, [k]: x } });
  };
  ui.actions.setVolume = (v) => {
    const volume = Math.min(1, Math.max(0, v));
    audio.setVolume(volume);
    save({ ...ui.save, volume });
  };
  ui.actions.cloudSignOut = () => {
    ui.cloud.busy = true;
    void storage
      .flush()
      .then(() => signOut(auth))
      .then(() => window.location.replace(window.location.pathname));
  };
  ui.actions.acceptRisk = () => {
    if (acceptRisk(game)) audio.sfx.uiBuy();
    else audio.sfx.uiDeny();
    refreshHud();
  };
  ui.actions.equip = (k) => {
    game.takeWeapon(k as WeaponKind);
    audio.sfx.uiClick();
    refreshHud();
  };

  // ---------------- 一局里的事件 ----------------
  screens.onBeforeBench = () => {
    game.buildMode = false;
    refreshHud();
  };
  /** 黎明后多久弹出卡牌（先让玩家看一眼"黎明"横幅） */
  let cardsAt = 0;
  game.events.on('cardsOffered', ({ ids }) => {
    ui.cards = ids;
    ui.rerolls = game.run.rerollsLeft;
    if (ui.screen !== 'cards') cardsAt = performance.now() + 1500;
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
    applyTraining(game, bonuses, ui.save.meta.bench, ui.save.meta.mastery, gunsFor(ui.save.meta));
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
    const chapter: MapId = chapterUnlocked(ui.save.meta.chapters, mapId) ? mapId : 'outpost';
    const side = sidearmOk(bonuses, params.sidearm) ? params.sidearm : null;
    save({ ...ui.save, meta: { ...ui.save.meta, lastDifficulty: d, lastSidearm: side, lastChapter: chapter } });
    // 开一局新的会覆盖旧检查点：旧的那一局按已经撑过的夜数结算
    const old = peekCheckpoint(storage.get(RUN_KEY));
    if (old && isDifficulty(old.difficulty)) {
      const nights = old.phase === 'cards' ? old.night : old.night - 1;
      const [meta] = settleRun(ui.save.meta, { difficulty: old.difficulty, nights, won: false, kills: old.kills, headshotKills: old.headshotKills, chapter: old.chapter, weaponKills: old.weaponKills, weaponHeads: old.weaponHeads });
      // 旧检查点里的备弹也退回去
      for (const [k, n] of Object.entries(old.ammo)) meta.ammo[k as WeaponKind] = (meta.ammo[k as WeaponKind] ?? 0) + (n ?? 0);
      save({ ...ui.save, meta });
      storage.remove(RUN_KEY);
    }
    ranked = true;
    // 子弹：库存整份带进这一局（结算时把剩下的退回来）；无限弹药时库存不动
    const stock = { ...ui.save.meta.ammo };
    if (AMMO_LIMITED) save({ ...ui.save, meta: { ...cloneMeta(ui.save.meta), ammo: {} } });
    applyMeta(game, bonuses, { difficulty: d, sidearm: side, chapter, bench: ui.save.meta.bench, mastery: ui.save.meta.mastery, ammo: stock, guns: gunsFor(ui.save.meta), trialGuns: lockedGuns(ui.save.meta) });
    startRun(game);
    enterPlay('play');
  } else if (params.tdm) {
    // 5v5 团队死斗：不结算勋章、不存检查点；用当前解锁的枪，工坊升到 3 级
    game.config = { ...configFor(bonuses, 'normal', 'outpost', ui.save.meta.bench), extras: false, ammo: false, endless: false };
    game.run.phase = 'night';
    game.scrap = 0;
    // 玩家用一把步枪（没解锁就用冲锋枪 / 手枪）
    const k: WeaponKind = (['rifle', 'smg'] as WeaponKind[]).find((w) => bonuses.weapons.has(w)) ?? 'rifle';
    const slot = game.loadout[k];
    slot.owned = slot.carried = true;
    slot.tier = 2;
    slot.mag = game.statsOf(k, 2).mag;
    game.player.weapon = k;
    game.player.tier = 2;
    game.loadout.pistol.tier = 2;
    startTdm(game);
    ui.inTdm = true;
    view.setNight(0.05, true);
    enterPlay('play', game.player.x, game.player.z - 10);
    toast('团队死斗 · 先到 50 杀获胜');
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
