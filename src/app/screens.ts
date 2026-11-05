import type { Game } from '../game/sim';
import { hud } from '../ui/hud';
import { ui, type Screen } from '../ui/store';
import type { InputController } from './input';

/**
 * 界面状态机：切换界面时决定输入是否生效、鼠标锁定还是释放；Esc / E / 失焦 / 指针锁定丢失的处理。
 * 回到游戏就锁定鼠标，进入任何菜单就释放，这样才能点按钮。
 * 不是在点击 / 按键里触发时浏览器可能拒绝，那就在画面上提示"点击继续"。
 */
export class Screens {
  private benchJustOpened = false;
  /** 暂停 / 工坊关掉后回到哪个操作界面（一局里或训练场） */
  playScreen: 'play' | 'training' = 'play';
  private readonly off: Array<() => void> = [];
  /** 打开工坊之前调用（退出建造模式、刷新 HUD） */
  onBeforeBench: () => void = () => {};

  constructor(
    private readonly game: Game,
    private readonly input: InputController,
  ) {
    // E：靠近工坊时打开工坊（输入层收到 true 就不再当成修理）
    input.onInteract = () => this.openBench();
    const onKey = (e: KeyboardEvent): void => this.onKey(e);
    // Tab：按住看本局面板（属性 / 加成 / 击杀 / 建筑），松开就关。浏览器默认会切焦点，拦掉
    const onTabDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Tab') return;
      e.preventDefault();
      if (this.isPlaying && this.inRun) hud.tab.open = true;
    };
    const onTabUp = (e: KeyboardEvent): void => {
      if (e.code === 'Tab') hud.tab.open = false;
    };
    window.addEventListener('keydown', onTabDown);
    window.addEventListener('keyup', onTabUp);
    this.off.push(
      () => window.removeEventListener('keydown', onTabDown),
      () => window.removeEventListener('keyup', onTabUp),
    );
    const onBlur = (): void => {
      hud.tab.open = false;
      if (this.isPlaying && this.inRun) this.set('pause');
    };
    // 玩家按 Esc 时浏览器会自己退出指针锁定（页面收不到这次按键），这里把它当作"暂停"
    const onLockChange = (): void => {
      if (!input.locked && this.isPlaying && this.inRun) this.set('pause');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onLockChange);
    this.off.push(
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('blur', onBlur),
      () => document.removeEventListener('pointerlockchange', onLockChange),
    );
  }

  /** 在操作角色的界面（一局里或训练场） */
  get isPlaying(): boolean {
    return ui.screen === 'play' || ui.screen === 'training';
  }

  /** 当前界面是否需要推进模拟：菜单 / 大厅的背景也在跑；操作角色时要等鼠标锁定，不让僵尸白打人 */
  get simulating(): boolean {
    return ui.screen === 'menu' || ui.screen === 'lobby' || (this.isPlaying && this.input.locked);
  }

  /** 正在打一局（不在菜单） */
  get inRun(): boolean {
    return this.game.run.phase !== 'menu';
  }

  set(s: Screen): void {
    if (s === 'play' || s === 'training') this.playScreen = s;
    else hud.tab.open = false;
    ui.screen = s;
    const playing = this.isPlaying;
    this.input.enabled = playing;
    if (playing) this.input.requestLock();
    else this.input.releaseLock();
  }

  private openBench(): boolean {
    if (ui.screen !== 'play' || this.game.run.phase !== 'day' || !hud.benchNear) return false;
    this.onBeforeBench();
    this.set('bench');
    // 同一次按键还会传到下面的 onKey，别让它马上又把工坊关掉
    this.benchJustOpened = true;
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      if (ui.screen === 'play' || ui.screen === 'training') this.set('pause');
      else if (ui.screen === 'pause' || ui.screen === 'bench') this.set(this.playScreen);
    } else if (e.code === 'KeyE' && ui.screen === 'bench' && !this.benchJustOpened) {
      this.set('play');
    }
    this.benchJustOpened = false;
  }

  dispose(): void {
    for (const f of this.off) f();
  }
}
