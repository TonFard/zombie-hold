import type { WeaponKind } from '../game/data/weapons';
import type { ZombieKind } from '../game/data/zombies';
import type { StructureKind } from '../game/data/structures';
import type { AudioEngine } from './engine';

/** 在 0.92–1.08 之间随机一点音高，连续的同一种声音不会像复制粘贴 */
const jit = (amount = 0.08): number => 1 + (Math.random() * 2 - 1) * amount;

/** 所有音效的合成配方。位置参数 (x, z) 是世界坐标，用于距离衰减和左右声像。 */
export class Sfx {
  constructor(private readonly e: AudioEngine) {}

  // ---------------- 武器 ----------------

  shot(kind: WeaponKind): void {
    const e = this.e;
    if (!e.ready) return;
    const j = jit();
    switch (kind) {
      case 'pistol': {
        if (!e.gate('shot-pistol', 0.05)) return;
        const out = e.flat(0.9) ?? undefined;
        e.noise({ dur: 0.09, vol: 0.5, filter: { type: 'highpass', freq: 1400 * j }, out });
        e.tone({ freq: 520 * j, to: 110, dur: 0.1, vol: 0.32, type: 'triangle', out });
        e.tone({ freq: 170, to: 60, dur: 0.14, vol: 0.28, out });
        break;
      }
      case 'smg': {
        if (!e.gate('shot-smg', 0.035)) return;
        const out = e.flat(0.75) ?? undefined;
        e.noise({ dur: 0.06, vol: 0.42, filter: { type: 'bandpass', freq: 2300 * j, q: 0.8 }, out });
        e.tone({ freq: 320 * j, to: 90, dur: 0.065, vol: 0.2, type: 'square', filter: { type: 'lowpass', freq: 1800 }, out });
        break;
      }
      case 'shotgun': {
        if (!e.gate('shot-shotgun', 0.1)) return;
        const out = e.flat(1) ?? undefined;
        e.noise({ dur: 0.34, vol: 0.85, filter: { type: 'lowpass', freq: 3600, to: 260 }, out });
        e.noise({ dur: 0.05, vol: 0.5, filter: { type: 'highpass', freq: 2500 }, out });
        e.tone({ freq: 150 * j, to: 36, dur: 0.32, vol: 0.75, out });
        break;
      }
      case 'rifle': {
        if (!e.gate('shot-rifle', 0.06)) return;
        const out = e.flat(0.95) ?? undefined;
        e.noise({ dur: 0.14, vol: 0.62, filter: { type: 'bandpass', freq: 1700 * j, q: 0.6 }, out });
        e.tone({ freq: 210 * j, to: 48, dur: 0.22, vol: 0.62, out });
        e.noise({ dur: 0.4, vol: 0.14, delay: 0.05, filter: { type: 'lowpass', freq: 650, to: 200 }, out });
        break;
      }
      case 'launcher': {
        if (!e.gate('shot-launcher', 0.2)) return;
        const out = e.flat(1) ?? undefined;
        e.tone({ freq: 120 * j, to: 42, dur: 0.32, vol: 0.62, out });
        e.noise({ dur: 0.38, vol: 0.5, filter: { type: 'lowpass', freq: 1100, to: 180 }, out });
        e.tone({ freq: 640, to: 1400, dur: 0.18, vol: 0.08, type: 'sawtooth', delay: 0.05, filter: { type: 'lowpass', freq: 1800 }, out });
        break;
      }
    }
  }

  turretShot(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('turret', 0.045)) return;
    const out = e.spatial(x, z, 0.8);
    if (!out) return;
    const j = jit(0.1);
    e.noise({ dur: 0.05, vol: 0.4, filter: { type: 'highpass', freq: 2200 }, out });
    e.tone({ freq: 440 * j, to: 150, dur: 0.06, vol: 0.2, type: 'square', filter: { type: 'lowpass', freq: 2000 }, out });
  }

  reload(start: boolean, kind: WeaponKind): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(0.8) ?? undefined;
    if (start) {
      if (kind === 'shotgun') {
        e.tone({ freq: 900, to: 400, dur: 0.06, vol: 0.35, type: 'square', filter: { type: 'bandpass', freq: 1500, q: 2 }, out });
        return;
      }
      // 卸弹匣：一声金属"咔"
      e.noise({ dur: 0.05, vol: 0.28, filter: { type: 'bandpass', freq: 2600, q: 3 }, out });
      e.tone({ freq: 1300, to: 700, dur: 0.05, vol: 0.12, type: 'square', filter: { type: 'bandpass', freq: 1500, q: 3 }, out });
      e.noise({ dur: 0.07, vol: 0.2, delay: 0.16, filter: { type: 'lowpass', freq: 900 }, out });
    } else {
      // 上膛：滑动加一声清脆的锁定
      e.noise({ dur: 0.07, vol: 0.22, filter: { type: 'bandpass', freq: 1300, to: 2200, q: 2 }, out });
      e.noise({ dur: 0.04, vol: 0.34, delay: 0.08, filter: { type: 'bandpass', freq: 3000, q: 3 }, out });
      e.tone({ freq: 1800, to: 900, dur: 0.04, vol: 0.1, type: 'square', delay: 0.08, filter: { type: 'bandpass', freq: 2000, q: 3 }, out });
    }
  }

  weaponSwitch(): void {
    const e = this.e;
    if (!e.gate('switch', 0.08)) return;
    const out = e.flat(0.7) ?? undefined;
    e.noise({ dur: 0.05, vol: 0.2, filter: { type: 'bandpass', freq: 1800, q: 2 }, out });
    e.noise({ dur: 0.04, vol: 0.2, delay: 0.09, filter: { type: 'bandpass', freq: 2800, q: 3 }, out });
  }

  // ---------------- 命中与爆炸 ----------------

  impact(x: number, z: number, flesh: boolean): void {
    const e = this.e;
    if (!e.gate(flesh ? 'hit-flesh' : 'hit-wall', 0.03)) return;
    const out = e.spatial(x, z, flesh ? 0.7 : 0.55);
    if (!out) return;
    if (flesh) {
      e.noise({ dur: 0.07, vol: 0.34, filter: { type: 'lowpass', freq: 800 * jit(0.2) }, out });
      e.tone({ freq: 160 * jit(0.2), to: 70, dur: 0.07, vol: 0.28, out });
    } else {
      e.noise({ dur: 0.08, vol: 0.45, filter: { type: 'bandpass', freq: 3200 * jit(0.2), q: 2 }, out });
      e.tone({ freq: 1500 * jit(0.15), to: 600, dur: 0.09, vol: 0.16, type: 'triangle', out });
    }
  }

  crit(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('crit', 0.06)) return;
    const out = e.spatial(x, z, 0.5);
    if (!out) return;
    e.tone({ freq: 1500, to: 2300, dur: 0.08, vol: 0.3, type: 'triangle', out });
  }

  explosion(x: number, z: number, big: boolean): void {
    const e = this.e;
    if (!e.gate(big ? 'boom-big' : 'boom', big ? 0.1 : 0.04)) return;
    const out = e.spatial(x, z, big ? 1.1 : 0.7);
    if (!out) return;
    const s = big ? 1 : 0.6;
    e.noise({ dur: 0.9 * s + 0.2, vol: 0.9, filter: { type: 'lowpass', freq: 2400, to: 120 }, out });
    e.tone({ freq: 95, to: 24, dur: 0.8 * s + 0.2, vol: 0.9, out });
    e.noise({ dur: 0.08, vol: 0.5, filter: { type: 'highpass', freq: 1800 }, out });
    if (big) e.noise({ dur: 0.9, vol: 0.18, delay: 0.12, filter: { type: 'bandpass', freq: 500, to: 160, q: 0.5 }, out });
  }

  acid(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('acid', 0.1)) return;
    const out = e.spatial(x, z, 0.8);
    if (!out) return;
    e.noise({ dur: 0.18, vol: 0.5, filter: { type: 'lowpass', freq: 700, to: 200 }, out });
    e.noise({ dur: 0.6, vol: 0.22, delay: 0.05, filter: { type: 'highpass', freq: 3500, to: 5500 }, out });
    e.tone({ freq: 220, to: 70, dur: 0.3, vol: 0.2, out });
  }

  // ---------------- 僵尸 ----------------

  growl(kind: ZombieKind, x: number, z: number): void {
    const e = this.e;
    if (!e.ready) return;
    const colossus = kind === 'colossus';
    if (!e.gate(colossus ? 'growl-boss' : 'growl', colossus ? 0.6 : 0.42)) return;
    const out = e.spatial(x, z, colossus ? 1.2 : 0.55);
    if (!out) return;
    const j = jit(0.12);
    switch (kind) {
      case 'walker':
        e.tone({ freq: 105 * j, to: 62 * j, dur: 0.8, vol: 0.22, type: 'sawtooth', vibrato: { rate: 6, depth: 0.05 }, filter: { type: 'lowpass', freq: 520, to: 260, q: 2 }, attack: 0.08, out });
        break;
      case 'runner':
        e.tone({ freq: 170 * j, to: 250 * j, dur: 0.5, vol: 0.18, type: 'sawtooth', vibrato: { rate: 12, depth: 0.08 }, filter: { type: 'bandpass', freq: 900, q: 2.5 }, attack: 0.05, out });
        e.noise({ dur: 0.45, vol: 0.1, filter: { type: 'bandpass', freq: 1500, q: 1.5 }, out });
        break;
      case 'bloater':
        e.tone({ freq: 62 * j, to: 46, dur: 1.0, vol: 0.3, type: 'sawtooth', vibrato: { rate: 9, depth: 0.12 }, filter: { type: 'lowpass', freq: 300, q: 4 }, attack: 0.1, out });
        e.noise({ dur: 0.8, vol: 0.14, filter: { type: 'lowpass', freq: 400, to: 160 }, out });
        break;
      case 'breaker':
        e.tone({ freq: 88 * j, to: 60, dur: 0.7, vol: 0.24, type: 'square', filter: { type: 'lowpass', freq: 420, q: 3 }, attack: 0.05, out });
        e.tone({ freq: 760, to: 520, dur: 0.18, vol: 0.06, type: 'triangle', delay: 0.1, out });
        break;
      case 'colossus':
        e.tone({ freq: 56, to: 34, dur: 1.9, vol: 0.55, type: 'sawtooth', vibrato: { rate: 4.5, depth: 0.06 }, filter: { type: 'lowpass', freq: 260, to: 120, q: 3 }, attack: 0.25, out });
        e.noise({ dur: 1.7, vol: 0.3, filter: { type: 'lowpass', freq: 500, to: 120 }, attack: 0.2, out });
        e.tone({ freq: 28, to: 20, dur: 1.9, vol: 0.5, out });
        break;
    }
  }

  zombieDie(kind: ZombieKind, x: number, z: number): void {
    const e = this.e;
    const colossus = kind === 'colossus';
    if (!e.gate(colossus ? 'die-boss' : 'die', colossus ? 0.5 : 0.045)) return;
    const out = e.spatial(x, z, colossus ? 1.2 : 0.6);
    if (!out) return;
    const base = { walker: 130, runner: 180, bloater: 80, breaker: 105, colossus: 46 }[kind] * jit(0.1);
    const len = colossus ? 1.4 : kind === 'bloater' ? 0.5 : 0.34;
    e.tone({ freq: base * 1.3, to: base * 0.4, dur: len, vol: colossus ? 0.6 : 0.24, type: 'sawtooth', filter: { type: 'lowpass', freq: 700, to: 180, q: 1.5 }, out });
    e.noise({ dur: colossus ? 0.6 : 0.16, vol: colossus ? 0.5 : 0.24, filter: { type: 'lowpass', freq: 600, to: 200 }, out });
    if (colossus) {
      e.tone({ freq: 70, to: 22, dur: 1.2, vol: 0.8, delay: 0.25, out });
      e.noise({ dur: 0.7, vol: 0.35, delay: 0.25, filter: { type: 'lowpass', freq: 900, to: 100 }, out });
    }
  }

  zombieAttack(kind: ZombieKind, target: 'none' | 'core' | 'player' | 'structure', x: number, z: number): void {
    const e = this.e;
    if (!e.gate(`atk-${target}`, 0.07)) return;
    const out = e.spatial(x, z, kind === 'colossus' ? 1.1 : 0.55);
    if (!out) return;
    const heavy = kind === 'colossus' ? 2 : kind === 'breaker' ? 1.4 : 1;
    e.noise({ dur: 0.12, vol: 0.14, filter: { type: 'bandpass', freq: 900, to: 400, q: 1 }, out });
    if (target === 'structure' || target === 'core') {
      // 砸在木头 / 金属上
      e.tone({ freq: 190 / heavy, to: 70 / heavy, dur: 0.14, vol: 0.4, delay: 0.05, out });
      e.noise({ dur: 0.1, vol: 0.3, delay: 0.05, filter: { type: 'bandpass', freq: 1400 / heavy, q: 1.2 }, out });
      if (target === 'core') e.tone({ freq: 330, to: 300, dur: 0.25, vol: 0.08, type: 'triangle', delay: 0.06, out });
    } else {
      e.tone({ freq: 120, to: 55, dur: 0.12, vol: 0.28, delay: 0.05, out });
    }
  }

  // ---------------- 玩家与据点 ----------------

  playerHurt(amount: number): void {
    const e = this.e;
    if (!e.gate('hurt', 0.12)) return;
    const out = e.flat(0.9) ?? undefined;
    const k = Math.min(1.4, 0.7 + amount / 40);
    e.tone({ freq: 140, to: 60, dur: 0.22, vol: 0.45 * k, out });
    e.noise({ dur: 0.12, vol: 0.3 * k, filter: { type: 'lowpass', freq: 900 }, out });
    e.tone({ freq: 260, to: 170, dur: 0.18, vol: 0.12, type: 'sawtooth', filter: { type: 'lowpass', freq: 700 }, out });
  }

  playerDie(): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(1) ?? undefined;
    e.tone({ freq: 160, to: 38, dur: 1.2, vol: 0.55, type: 'sawtooth', filter: { type: 'lowpass', freq: 600, to: 120 }, out });
    e.noise({ dur: 0.6, vol: 0.35, filter: { type: 'lowpass', freq: 500, to: 120 }, out });
  }

  coreHit(): void {
    const e = this.e;
    if (!e.gate('core', 0.35)) return;
    const out = e.flat(0.8) ?? undefined;
    e.tone({ freq: 90, to: 70, dur: 0.35, vol: 0.28, type: 'square', filter: { type: 'lowpass', freq: 500 }, out });
    e.noise({ dur: 0.3, vol: 0.2, filter: { type: 'bandpass', freq: 1800, q: 2 }, out });
    e.tone({ freq: 440, to: 360, dur: 0.5, vol: 0.07, type: 'triangle', out });
  }

  structureHit(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('struct-hit', 0.12)) return;
    const out = e.spatial(x, z, 0.5);
    if (!out) return;
    e.noise({ dur: 0.08, vol: 0.42, filter: { type: 'bandpass', freq: 1200 * jit(0.2), q: 1.5 }, out });
    e.tone({ freq: 240 * jit(0.2), to: 140, dur: 0.1, vol: 0.28, type: 'triangle', out });
  }

  structureBuilt(kind: StructureKind, x: number, z: number): void {
    const e = this.e;
    if (!e.gate('build', 0.05)) return;
    const out = e.spatial(x, z, 0.9);
    if (!out) return;
    // 两下敲击；地刺更尖，炮塔多一声电机启动
    const hit = (delay: number, f: number) => {
      e.noise({ dur: 0.07, vol: 0.24, delay, filter: { type: 'bandpass', freq: f, q: 1.4 }, out });
      e.tone({ freq: f / 6, to: f / 12, dur: 0.1, vol: 0.24, delay, out });
    };
    hit(0, kind === 'spikes' ? 2200 : 1200);
    hit(0.13, kind === 'spikes' ? 2600 : 1500);
    if (kind === 'turret') e.tone({ freq: 160, to: 520, dur: 0.35, vol: 0.12, type: 'sawtooth', delay: 0.26, filter: { type: 'lowpass', freq: 900 }, out });
  }

  structureSold(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('sold', 0.06)) return;
    const out = e.spatial(x, z, 0.7);
    if (!out) return;
    e.noise({ dur: 0.14, vol: 0.3, filter: { type: 'bandpass', freq: 900, to: 400, q: 1 }, out });
    e.tone({ freq: 700, to: 1100, dur: 0.08, vol: 0.1, type: 'triangle', delay: 0.1, out });
  }

  structureBroken(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('broken', 0.08)) return;
    const out = e.spatial(x, z, 0.95);
    if (!out) return;
    e.noise({ dur: 0.55, vol: 0.55, filter: { type: 'lowpass', freq: 2200, to: 220 }, out });
    e.tone({ freq: 110, to: 38, dur: 0.4, vol: 0.5, out });
    for (let i = 0; i < 4; i++) e.noise({ dur: 0.06, vol: 0.2, delay: 0.1 + i * 0.07 + Math.random() * 0.04, filter: { type: 'bandpass', freq: 1800 + Math.random() * 1600, q: 2 }, out });
  }

  spikes(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('spikes', 0.08)) return;
    const out = e.spatial(x, z, 0.5);
    if (!out) return;
    e.noise({ dur: 0.05, vol: 0.45, filter: { type: 'highpass', freq: 3000 }, out });
    e.tone({ freq: 900, to: 300, dur: 0.07, vol: 0.2, type: 'sawtooth', filter: { type: 'lowpass', freq: 1500 }, out });
  }

  repair(x: number, z: number): void {
    const e = this.e;
    if (!e.gate('repair', 0.09)) return;
    const out = e.spatial(x, z, 0.7);
    if (!out) return;
    // 棘轮扳手的几下"嗒嗒"
    for (let i = 0; i < 3; i++) e.noise({ dur: 0.03, vol: 0.2, delay: i * 0.045, filter: { type: 'bandpass', freq: 2600 + i * 300, q: 4 }, out });
    e.tone({ freq: 520, to: 780, dur: 0.1, vol: 0.06, type: 'triangle', delay: 0.14, out });
  }

  pickup(x: number, z: number, amount: number): void {
    const e = this.e;
    if (!e.gate('pickup', 0.05)) return;
    const out = e.spatial(x, z, 0.7);
    if (!out) return;
    const big = amount >= 30;
    e.tone({ freq: 880, dur: 0.12, vol: 0.14, type: 'triangle', out });
    e.tone({ freq: 1320, dur: 0.18, vol: 0.14, type: 'triangle', delay: 0.07, out });
    if (big) e.tone({ freq: 1760, dur: 0.24, vol: 0.12, type: 'triangle', delay: 0.14, out });
  }

  // ---------------- 界面与阶段 ----------------

  buildToggle(on: boolean): void {
    const e = this.e;
    if (!e.gate('build-toggle', 0.1)) return;
    const out = e.flat(0.7) ?? undefined;
    e.tone({ freq: on ? 520 : 420, to: on ? 780 : 260, dur: 0.1, vol: 0.24, type: 'triangle', out });
  }

  uiClick(): void {
    const e = this.e;
    if (!e.gate('ui-click', 0.04)) return;
    const out = e.flat(0.7) ?? undefined;
    e.tone({ freq: 700, to: 500, dur: 0.06, vol: 0.25, type: 'triangle', out });
    e.noise({ dur: 0.02, vol: 0.18, filter: { type: 'highpass', freq: 3000 }, out });
  }

  uiBuy(): void {
    const e = this.e;
    if (!e.gate('ui-buy', 0.08)) return;
    const out = e.flat(0.8) ?? undefined;
    e.tone({ freq: 660, dur: 0.08, vol: 0.14, type: 'triangle', out });
    e.tone({ freq: 990, dur: 0.14, vol: 0.14, type: 'triangle', delay: 0.07, out });
  }

  uiDeny(): void {
    const e = this.e;
    if (!e.gate('ui-deny', 0.2)) return;
    e.tone({ freq: 160, to: 120, dur: 0.14, vol: 0.24, type: 'square', filter: { type: 'lowpass', freq: 600 }, out: e.flat(0.8) ?? undefined });
  }

  dayStart(): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(0.8) ?? undefined;
    // 天亮：三个上行的音
    [392, 523, 659].forEach((f, i) => e.tone({ freq: f, dur: 1.1, vol: 0.11, type: 'sine', attack: 0.06, delay: i * 0.22, out }));
  }

  nightStart(boss: boolean): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(1) ?? undefined;
    // 警报般的低沉号角
    e.tone({ freq: 82, to: 70, dur: 2.2, vol: 0.26, type: 'sawtooth', filter: { type: 'lowpass', freq: 380, to: 160, q: 2 }, attack: 0.3, out });
    e.tone({ freq: 123, to: 104, dur: 2.2, vol: 0.15, type: 'sawtooth', filter: { type: 'lowpass', freq: 420, to: 180, q: 2 }, attack: 0.35, out });
    if (boss) {
      e.tone({ freq: 41, to: 32, dur: 2.8, vol: 0.4, attack: 0.4, out });
      e.noise({ dur: 2.2, vol: 0.16, filter: { type: 'lowpass', freq: 220, to: 90 }, attack: 0.4, out });
    }
  }

  dawn(): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(0.8) ?? undefined;
    [330, 440, 554, 660].forEach((f, i) => e.tone({ freq: f, dur: 1.4, vol: 0.09, attack: 0.08, delay: i * 0.18, out }));
  }

  cardPick(): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(0.9) ?? undefined;
    e.tone({ freq: 523, dur: 0.25, vol: 0.14, type: 'triangle', out });
    e.tone({ freq: 784, dur: 0.4, vol: 0.14, type: 'triangle', delay: 0.09, out });
    e.noise({ dur: 0.2, vol: 0.08, filter: { type: 'highpass', freq: 4500 }, out });
  }

  win(): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(0.9) ?? undefined;
    [392, 494, 587, 784, 988].forEach((f, i) => e.tone({ freq: f, dur: 1.2, vol: 0.12, type: 'triangle', attack: 0.04, delay: i * 0.16, out }));
    e.tone({ freq: 196, dur: 2.2, vol: 0.14, attack: 0.1, out });
  }

  lose(): void {
    const e = this.e;
    if (!e.ready) return;
    const out = e.flat(0.9) ?? undefined;
    [294, 277, 262, 196].forEach((f, i) => e.tone({ freq: f, dur: 1.2, vol: 0.12, type: 'sawtooth', filter: { type: 'lowpass', freq: 700 }, attack: 0.05, delay: i * 0.4, out }));
  }
}
