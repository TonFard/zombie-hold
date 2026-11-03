import type { WeaponKind } from '../data/weapons';

/** 一颗在空中飞的子弹：有位置、速度，每帧受重力下坠，扫掠检测命中 */
export interface Bullet {
  id: number;
  kind: WeaponKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 每次命中的基础伤害（已含全局伤害加成） */
  damage: number;
  /** 还能再穿透几个目标 */
  pierceLeft: number;
  /** 已经飞过的路程（米） */
  traveled: number;
  range: number;
  burn: number;
  /** 命中减速比例（轻机枪招牌） */
  slowHit: number;
  /** 爆头击杀返还的子弹数（狙击招牌） */
  refund: number;
  /** 已经打过的僵尸 id，穿透时不会重复命中 */
  hit: number[];
}
