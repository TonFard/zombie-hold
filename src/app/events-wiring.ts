import type { AudioSystem } from '../audio';
import type { Game } from '../game/sim';
import { bumpPop, hud, markBoxTaken, markDropTaken, procCard } from '../ui/hud';
import { ui } from '../ui/store';

/**
 * 逻辑事件 → HUD 标记 / 横幅；音频手势解锁和界面点击声。
 * 命中 / 击杀标记、受击方向、发电机受击：逻辑层只发事件，HUD 自己决定怎么显示。
 * 返回解除所有监听的函数。
 */
export function wireEvents(game: Game, audio: AudioSystem): () => void {
  const off: Array<() => void> = [];
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
      if (stage === 'taken') markDropTaken();
    }),
    game.events.on('zombieAttack', ({ zombie, target }) => {
      if (target !== 'player') return;
      const p = game.player;
      // 方位由 syncHud 每次按当前视线重算
      hud.hurtMarks.push({ a: 0, world: Math.atan2(zombie.x - p.x, zombie.z - p.z), life: 1 });
      if (hud.hurtMarks.length > 6) hud.hurtMarks.shift();
    }),
    game.events.on('coreDamaged', () => {
      hud.coreHurt = 1;
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
