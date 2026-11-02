/** 榴弹和它的子弹：会飞行、会爆炸 */
export interface Projectile {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  damage: number;
  aoe: number;
  /** 爆炸后分裂出的小炸弹数 */
  split: number;
  /** 小炸弹不再分裂 */
  bomblet: boolean;
}
