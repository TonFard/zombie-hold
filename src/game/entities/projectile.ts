import type { WeaponKind } from '../data/weapons';

/** 迫击炮弹（以前还有玩家的榴弹，已删）：沿抛物线飞行（受重力），碰到地面、墙或僵尸就爆炸 */
export interface Projectile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  aoe: number;
  /** 爆炸后分裂出的小炸弹数 */
  split: number;
  /** 小炸弹不再分裂 */
  bomblet: boolean;
  /** 打出这一发的武器（记熟练度用）；迫击炮没有 */
  weapon?: WeaponKind;
}
