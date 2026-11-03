export type ZombieKind = 'walker' | 'runner' | 'bloater' | 'breaker' | 'colossus' | 'spitter' | 'screamer';

export interface ZombieDef {
  kind: ZombieKind;
  name: string;
  hp: number;
  /** 单位：格 / 秒 */
  speed: number;
  radius: number;
  damage: number;
  /** 两次攻击的间隔（秒） */
  attackInterval: number;
  /** 对建筑的伤害倍率 */
  structMult: number;
  /** 掉落零件 */
  reward: number;
  /** 玩家进入这个距离后改为追玩家（0 = 只在贴脸时） */
  aggro: number;
  /** 大体型：用膨胀后的地图规划路线 */
  large: boolean;
  /** 命中体积：身体是半径 radius、高 height 的圆柱，头是一个球 */
  height: number;
  head: { y: number; r: number; fwd: number };
  /** 头部脆弱系数：1 = 吃满武器的爆头倍率，越小头越硬（头盔、装甲） */
  headVuln: number;
  /** 远程攻击（吐酸者）：射程、间隔；0 = 只会近战 */
  spitRange?: number;
  spitInterval?: number;
  /** 爆头一击必杀（吐酸者的酸囊） */
  headInstakill?: boolean;
  /** 尖叫（尖啸者）：半径、加速比例、持续、冷却 */
  scream?: { radius: number; boost: number; time: number; cd: number };
  /** 冲锋（巨像，M13）：触发距离、蓄力、冲锋速度和时长、撞击伤害、硬直、冷却、弱点（胸口）的高度 / 半径 / 倍率 */
  charge?: { range: number; windup: number; speed: number; time: number; damage: number; stun: number; cd: number; core: { y: number; r: number; mult: number } };
}

export const ZOMBIES: Record<ZombieKind, ZombieDef> = {
  walker: {
    kind: 'walker',
    name: '行尸',
    hp: 60,
    speed: 1.6,
    radius: 0.32,
    damage: 10,
    attackInterval: 1.0,
    structMult: 1,
    reward: 3,
    aggro: 9,
    large: false,
    height: 1.85,
    head: { y: 1.62, r: 0.19, fwd: 0.08 },
    headVuln: 1,
  },
  runner: {
    kind: 'runner',
    name: '奔袭者',
    hp: 35,
    speed: 3.6,
    radius: 0.28,
    damage: 7,
    attackInterval: 0.6,
    structMult: 0.6,
    reward: 4,
    aggro: 16,
    large: false,
    height: 1.8,
    head: { y: 1.6, r: 0.18, fwd: 0.14 },
    headVuln: 1,
  },
  bloater: {
    kind: 'bloater',
    name: '肿胀者',
    hp: 220,
    speed: 1.1,
    radius: 0.5,
    damage: 18,
    attackInterval: 1.0,
    structMult: 1,
    reward: 10,
    aggro: 6,
    large: true,
    height: 1.7,
    head: { y: 1.45, r: 0.21, fwd: 0.1 },
    headVuln: 1,
  },
  breaker: {
    kind: 'breaker',
    name: '破墙者',
    hp: 160,
    speed: 1.5,
    radius: 0.4,
    damage: 14,
    attackInterval: 1.1,
    structMult: 3,
    reward: 8,
    aggro: 4,
    large: false,
    height: 1.9,
    head: { y: 1.68, r: 0.19, fwd: 0.06 },
    // 戴着头盔
    headVuln: 0.7,
  },
  colossus: {
    kind: 'colossus',
    name: '巨像',
    hp: 2400,
    speed: 1.0,
    radius: 0.95,
    damage: 45,
    attackInterval: 1.6,
    structMult: 2,
    reward: 150,
    aggro: 12,
    large: true,
    height: 3.9,
    head: { y: 3.45, r: 0.38, fwd: 0.2 },
    // 首领的头有装甲，爆头收益只有一半多一点
    headVuln: 0.6,
    charge: { range: 14, windup: 1.2, speed: 7, time: 1.3, damage: 40, stun: 3, cd: 10, core: { y: 2.4, r: 0.42, mult: 3 } },
  },
  spitter: {
    kind: 'spitter',
    name: '吐酸者',
    hp: 70,
    speed: 1.4,
    radius: 0.32,
    damage: 8,
    attackInterval: 1.2,
    structMult: 1,
    reward: 7,
    aggro: 14,
    large: false,
    height: 1.75,
    head: { y: 1.52, r: 0.2, fwd: 0.14 },
    headVuln: 1,
    spitRange: 11,
    spitInterval: 3.2,
    headInstakill: true,
  },
  screamer: {
    kind: 'screamer',
    name: '尖啸者',
    hp: 45,
    speed: 2.0,
    radius: 0.27,
    damage: 5,
    attackInterval: 0.9,
    structMult: 0.5,
    reward: 8,
    aggro: 12,
    large: false,
    height: 1.7,
    head: { y: 1.52, r: 0.18, fwd: 0.1 },
    headVuln: 1.2,
    scream: { radius: 8, boost: 0.4, time: 5, cd: 9 },
  },
};
