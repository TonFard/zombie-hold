import { ALIVE_CAP, bossFor } from '../game/data/waves';
import type { WeaponKind } from '../game/data/weapons';
import type { Game, GameEvents } from '../game/sim';
import { HALF_H, HALF_W } from '../game/world/grid';
import { surfaceAt } from '../game/world/surface';
import { Ambience } from './ambience';
import { AudioEngine, type Channel } from './engine';
import { Sfx } from './sfx';

export interface AudioSystem {
  engine: AudioEngine;
  sfx: Sfx;
  /** 预加载 TACZ 模型的采样音效（ogg） */
  useSamples(urls: string[]): void;
  /** 这一类枪现在是不是用着加载好的 TACZ 模型：是就停掉合成的枪声 / 换弹声（由渲染层接上） */
  sampledBy: ((kind: WeaponKind) => boolean) | null;
  /** 播放一个采样（玩家自己的声音，不做空间化） */
  sample(url: string, gain: number): void;
  /** 在用户手势里调用：创建 / 恢复 AudioContext 并启动环境声 */
  unlock(): void;
  /** 切回窗口 / 换输出设备后调用：恢复挂起的上下文，报废了就重建 */
  revive(): void;
  /** 设置页「测试声音」：一声枪响 + 一声界面音 */
  test(): void;
  setVolume(v: number): void;
  /** 分类音量（M20） */
  setChannel(ch: Channel, v: number): void;
  /** 每帧调用：更新听者位置、环境声的威胁度 */
  update(dt: number): void;
  dispose(): void;
}

/** 把游戏事件接到音效上。逻辑层完全不知道音频的存在。 */
export function createAudio(game: Game, volume: number, getYaw: () => number): AudioSystem {
  const engine = new AudioEngine();
  engine.setVolume(volume);
  const sfx = new Sfx(engine);
  const ambience = new Ambience(engine);
  const ev = game.events;
  const off: Array<() => void> = [];
  const on = <K extends keyof GameEvents>(key: K, fn: (payload: GameEvents[K]) => void): void => {
    off.push(ev.on(key, fn));
  };
  const sx = (cx: number) => cx - HALF_W + 0.5;
  const sz = (cy: number) => cy - HALF_H + 0.5;

  // 用 TACZ 模型的武器：枪声和换弹声由模型的动画音效负责，合成的就不放了。
  // 哪一类枪是不是用着 TACZ 模型由渲染层告诉我们（型号在局内会换，换上的模型还没加载好时照样放合成声）
  const sampled = (kind: WeaponKind): boolean => sys.sampledBy?.(kind) ?? false;
  on('shot', (e) => {
    if (!sampled(e.kind)) sfx.shot(e.kind);
  });
  on('reload', (e) => {
    if (!sampled(e.kind)) sfx.reload(e.start, e.kind);
  });
  on('weaponSwitch', () => sfx.weaponSwitch());
  on('slide', () => sfx.slide());
  on('meleeSwing', () => sfx.melee(false));
  on('meleeHit', (e) => {
    if (e.zombie) sfx.melee(true);
  });
  on('refund', () => sfx.refund());
  on('impact', (e) => sfx.impact(e.x, e.z, e.flesh, e.flesh ? undefined : surfaceAt(game, e.x, e.y, e.z, e.zone === 'ground')));
  on('zombieHit', (e) => {
    if (e.crit) sfx.crit(e.zombie.x, e.zombie.z);
    // 这一下打死了的话只放击杀的那一声（zombieDied 里）
    if (e.head && e.mine && e.zombie.hp > 0) sfx.headshot();
  });
  on('explosion', (e) => sfx.explosion(e.x, e.z, e.big));
  on('acid', (e) => sfx.acid(e.x, e.z));
  // 毒气爆燃的声音来自它的爆炸（explosion 事件）
  on('gas', (e) => {
    if (!e.ignite) sfx.acid(e.x, e.z);
  });
  on('split', (e) => sfx.acid(e.x, e.z));
  on('leap', (e) => {
    if (e.stage === 'windup') sfx.growl(e.zombie.kind, e.zombie.x, e.zombie.z);
  });
  // 首领：蓄力时咆哮（听声音也能读招），砸地 / 碎石落地是闷响，钢板掉下来是金属碰撞
  on('bossSkill', (e) => {
    const z = game.zombies.find((q) => q.id === e.id);
    if (!z) return;
    if (e.stage === 'windup') sfx.growl(z.kind, e.x, e.z);
    else if (e.stage === 'go' && (e.skill === 'cleave' || e.skill === 'hook')) sfx.melee(false);
    else if (e.stage === 'hit') sfx.melee(true);
  });
  on('bossPhase', (e) => sfx.growl(e.zombie.kind, e.zombie.x, e.zombie.z));
  on('bossSlam', (e) => sfx.explosion(e.x, e.z, false));
  on('markHit', (e) => {
    if (e.kind === 'rock') sfx.explosion(e.x, e.z, false);
  });
  on('bossSac', (e) => sfx.acid(e.x, e.z));
  on('plateBreak', (e) => {
    sfx.impact(e.zombie.x, e.zombie.z, false, 'metal');
    sfx.structureBroken(e.zombie.x, e.zombie.z);
  });
  on('turretShot', (e) => sfx.turretShot(e.x0, e.z0));
  // 一批僵尸同时出生时只有一部分会吼，否则入口处会变成一团噪音
  on('zombieSpawned', (z) => {
    if (z.def.boss || Math.random() > 0.45) sfx.growl(z.kind, z.x, z.z);
  });
  on('zombieDied', (e) => {
    sfx.zombieDie(e.zombie.kind, e.zombie.x, e.zombie.z);
    if (e.head && e.mine) sfx.headshotKill();
  });
  on('zombieAttack', (e) => sfx.zombieAttack(e.zombie.kind, e.target, e.zombie.x, e.zombie.z));
  on('playerDamaged', (e) => sfx.playerHurt(e.amount));
  on('playerDied', () => sfx.playerDie());
  on('coreDamaged', () => sfx.coreHit());
  on('structureAdded', (s) => sfx.structureBuilt(s.kind, sx(s.cx), sz(s.cy)));
  on('structureDamaged', (e) => sfx.structureHit(sx(e.structure.cx), sz(e.structure.cy)));
  on('structureRemoved', (e) => {
    const s = e.structure;
    if (e.destroyed) sfx.structureBroken(sx(s.cx), sz(s.cy));
    else sfx.structureSold(sx(s.cx), sz(s.cy));
  });
  on('spikesHit', (e) => {
    const s = game.structures.get(e.id);
    if (s) sfx.spikes(sx(s.cx), sz(s.cy));
  });
  on('repaired', (e) => sfx.repair(e.x, e.z));
  on('scrap', (e) => {
    // 击杀掉落的零件在僵尸脚下，不响；箱子、夜晚奖励、拆除返还都在玩家附近
    const p = game.player;
    if (Math.hypot(e.x - p.x, e.z - p.z) < 3) sfx.pickup(e.x, e.z, e.amount);
  });
  on('buildMode', (e) => sfx.buildToggle(e.on));
  on('phase', (e) => {
    if (e.phase === 'day') {
      ambience.setMode('day');
      sfx.dayStart();
    } else if (e.phase === 'night') {
      ambience.setMode('night');
      sfx.nightStart(bossFor(e.night) !== null);
    } else if (e.phase === 'cards') {
      ambience.setMode('day');
      sfx.dawn();
    } else {
      ambience.setMode('menu');
    }
  });
  on('runEnded', (e) => (e.won ? sfx.win() : sfx.lose()));

  const pending: string[] = [];
  const sys: AudioSystem = {
    engine,
    sfx,
    sampledBy: null,
    useSamples(urls) {
      for (const u of urls) {
        if (engine.ready) engine.load(u);
        else pending.push(u);
      }
    },
    sample(url, gain) {
      engine.channel = 'weapons';
      engine.sample(url, gain, engine.flat(0.9) ?? undefined);
    },
    unlock() {
      for (const u of pending.splice(0)) engine.load(u);
      engine.unlock();
      ambience.start();
    },
    revive() {
      engine.revive();
    },
    test() {
      sfx.uiBuy();
      window.setTimeout(() => sfx.shot('pistol'), 250);
    },
    setVolume(v) {
      engine.setVolume(v);
    },
    setChannel(ch, v) {
      engine.setChannel(ch, v);
    },
    update(dt) {
      engine.lx = game.player.x;
      engine.lz = game.player.z;
      engine.lyaw = getYaw();
      ambience.update(dt, Math.min(1, game.zombies.length / (ALIVE_CAP * 0.6)));
    },
    dispose() {
      for (const f of off) f();
      ambience.dispose();
      engine.dispose();
    },
  };
  return sys;
}
