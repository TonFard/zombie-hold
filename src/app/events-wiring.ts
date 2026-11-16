import type { AudioSystem } from '../audio';
import type { Game } from '../game/sim';
import { PLAYER } from '../game/systems/tdm';
import { bumpPop, hud, markBoxTaken, markDropTaken, noteZombie, procCard } from '../ui/hud';
import { ui } from '../ui/store';

/**
 * 逻辑事件 → HUD 标记 / 横幅；音频手势解锁和界面点击声。
 * 命中 / 击杀标记、受击方向、发电机受击：逻辑层只发事件，HUD 自己决定怎么显示。
 * 返回解除所有监听的函数。
 */
export function wireEvents(game: Game, audio: AudioSystem): () => void {
  const off: Array<() => void> = [];
  /** 对战：自己刚从背后砍中一刀（tdmStab 后面紧跟着的那个 soldierHit 把命中标记画成橙色）；记下时间，隔了一步就不算 */
  let backstab = false;
  let backstabAt = -1;
  /** 空投箱已经打开过（零件已经给了）：之后换上枪发的 taken 不再标一次零件收入 */
  let dropOpened = false;
  off.push(
    game.events.on('zombieHit', (e) => {
      // 准星上的命中标记只认自己打的：炮塔、地刺、队友打中的不闪
      if (e.mine) {
        // 霰弹一枪多颗弹丸：同一下里有一颗打中头，标记就保持金色
        hud.hitHead = e.head || (hud.hit > 0.9 && hud.hitHead);
        hud.hitCrit = e.crit || (hud.hit > 0.9 && hud.hitCrit);
        hud.hit = 1;
      }
      if (e.crit) {
        procCard(game, 'crit');
        procCard(game, 'berserk');
      }
      if (e.head) procCard(game, 'weakspot');
    }),
    game.events.on('zombieDied', (e) => {
      if (e.mine) {
        // 一枪穿两只：里面有一只是爆头打死的，击杀标记就按爆头的来
        hud.killHead = e.head || (hud.kill > 0.9 && hud.killHead);
        hud.kill = 1;
      }
      if (game.mods.lifesteal > 0) procCard(game, 'lifesteal');
    }),
    // 持续回血（嗜血池 / 急救训练）：一小口一小口地回，HUD 上合并成一个 +N
    game.events.on('healed', ({ amount }) => bumpPop(hud.healPop, amount)),
    // 卡牌触发反馈：闪一下 HUD 上对应的卡牌格
    game.events.on('refund', ({ amount }) => {
      bumpPop(hud.ammoPop, amount);
      if (game.mods.headRefund > 0) procCard(game, 'scavmag');
    }),
    game.events.on('chainBlast', () => procCard(game, 'chain')),
    game.events.on('combo', () => procCard(game, 'momentum')),
    game.events.on('scrap', () => {
      procCard(game, 'scavenger');
      procCard(game, 'c-greed');
    }),
    game.events.on('scrapBox', ({ taken }) => {
      if (taken) markBoxTaken();
    }),
    game.events.on('airdrop', ({ stage }) => {
      // open = 零件到手了、箱里还留着枪；没有试用枪时直接是 taken。换上枪时的那一次 taken 不是零件收入
      if (stage === 'open' || (stage === 'taken' && !dropOpened)) markDropTaken();
      dropOpened = stage === 'open';
    }),
    game.events.on('zombieAttack', ({ zombie, target }) => {
      if (target !== 'player') return;
      const p = game.player;
      // 方位由 syncHud 每次按当前视线重算
      hud.hurtMarks.push({ a: 0, world: Math.atan2(zombie.x - p.x, zombie.z - p.z), life: 1 });
      if (hud.hurtMarks.length > 6) hud.hurtMarks.shift();
    }),
    // 对战：自己打中 / 打死对面的人（枪、刀、手雷都从 tdmHurt 发这两个事件），准星上的命中标记；被打中时显示是从哪边来的
    game.events.on('tdmStab', (e) => {
      backstab = e.id === PLAYER && e.back;
      backstabAt = game.run.time;
    }),
    game.events.on('soldierHit', (e) => {
      if (!e.byPlayer) return;
      hud.hitHead = e.head || (hud.hit > 0.9 && hud.hitHead);
      hud.hitCrit = backstab && backstabAt === game.run.time;
      backstab = false;
      hud.hit = 1;
    }),
    game.events.on('soldierDied', (e) => {
      if (!e.byPlayer) return;
      hud.killHead = e.head || (hud.kill > 0.9 && hud.killHead);
      hud.kill = 1;
    }),
    game.events.on('tdmHurt', ({ fromId }) => {
      const s = game.tdm.soldiers.find((x) => x.id === fromId);
      if (!s) return;
      const p = game.player;
      hud.hurtMarks.push({ a: 0, world: Math.atan2(s.x - p.x, s.z - p.z), life: 1 });
      if (hud.hurtMarks.length > 6) hud.hurtMarks.shift();
    }),
    game.events.on('coreDamaged', () => {
      hud.coreHurt = 1;
    }),
    // 第一次遇到的僵尸（图鉴里还没有击杀记录）：弹一张情报卡说它有什么能力、怎么对付。训练场的靶子、对战不算
    game.events.on('zombieSpawned', (z) => {
      if (z.dummy || game.tdm.on || game.config.training) return;
      if (game.run.phase !== 'day' && game.run.phase !== 'night') return;
      noteZombie(z.kind, (ui.save.codex.kills[z.kind] ?? 0) > 0);
    }),
    game.events.on('banner', (b) => {
      ui.banner = { text: b.text, sub: b.sub, id: ui.banner.id + 1 };
    }),
  );

  // 浏览器要求在用户手势里才能创建 / 恢复 AudioContext
  const onGesture = (): void => audio.unlock();
  // 买卖和选卡有自己的声音，其余按钮统一用点击声
  const onUiClick = (e: MouseEvent): void => {
    const el = (e.target as Element | null)?.closest('button');
    if (el && !el.matches('.buy, .up, .card, [data-silent]')) audio.sfx.uiClick();
  };
  // 手柄、触屏也算手势（以前只认鼠标 / 键盘：只用手柄玩就一直没声音）
  const gestures = ['pointerdown', 'keydown', 'touchstart', 'gamepadconnected'] as const;
  for (const g of gestures) window.addEventListener(g, onGesture);
  // 切回窗口 / 窗口重新可见：浏览器可能把上下文挂起了
  const onBack = (): void => {
    if (document.visibilityState === 'visible') audio.revive();
  };
  window.addEventListener('focus', onBack);
  document.addEventListener('visibilitychange', onBack);
  // 换了耳机 / 音箱：有的系统会让旧上下文挂起或报废
  const media = navigator.mediaDevices;
  const onDevice = (): void => audio.revive();
  media?.addEventListener?.('devicechange', onDevice);
  document.addEventListener('click', onUiClick);
  off.push(
    () => {
      for (const g of gestures) window.removeEventListener(g, onGesture);
    },
    () => window.removeEventListener('focus', onBack),
    () => document.removeEventListener('visibilitychange', onBack),
    () => media?.removeEventListener?.('devicechange', onDevice),
    () => document.removeEventListener('click', onUiClick),
  );
  return () => {
    for (const f of off) f();
  };
}
