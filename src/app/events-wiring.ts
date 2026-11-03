import type { AudioSystem } from '../audio';
import type { Game } from '../game/sim';
import { hud } from '../ui/hud';
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
      hud.hit = 1;
      hud.hitCrit = e.crit;
      hud.hitHead = e.head;
    }),
    game.events.on('zombieDied', () => {
      hud.kill = 1;
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
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
  document.addEventListener('click', onUiClick);
  off.push(
    () => window.removeEventListener('pointerdown', onGesture),
    () => window.removeEventListener('keydown', onGesture),
    () => document.removeEventListener('click', onUiClick),
  );
  return () => {
    for (const f of off) f();
  };
}
