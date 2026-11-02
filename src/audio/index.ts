import { ALIVE_CAP, bossFor } from '../game/data/waves';
import type { Game, GameEvents } from '../game/sim';
import { HALF_H, HALF_W } from '../game/world/grid';
import { Ambience } from './ambience';
import { AudioEngine } from './engine';
import { Sfx } from './sfx';

export interface AudioSystem {
  engine: AudioEngine;
  sfx: Sfx;
  /** 在用户手势里调用：创建 / 恢复 AudioContext 并启动环境声 */
  unlock(): void;
  setVolume(v: number): void;
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

  on('shot', (e) => sfx.shot(e.kind));
  on('reload', (e) => sfx.reload(e.start, e.kind));
  on('weaponSwitch', () => sfx.weaponSwitch());
  on('impact', (e) => sfx.impact(e.x, e.z, e.flesh));
  on('zombieHit', (e) => {
    if (e.crit) sfx.crit(e.zombie.x, e.zombie.z);
  });
  on('explosion', (e) => sfx.explosion(e.x, e.z, e.big));
  on('acid', (e) => sfx.acid(e.x, e.z));
  on('turretShot', (e) => sfx.turretShot(e.x0, e.z0));
  // 一批僵尸同时出生时只有一部分会吼，否则入口处会变成一团噪音
  on('zombieSpawned', (z) => {
    if (z.kind === 'colossus' || Math.random() > 0.45) sfx.growl(z.kind, z.x, z.z);
  });
  on('zombieDied', (e) => sfx.zombieDie(e.zombie.kind, e.zombie.x, e.zombie.z));
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

  return {
    engine,
    sfx,
    unlock() {
      engine.unlock();
      ambience.start();
    },
    setVolume(v) {
      engine.setVolume(v);
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
}
