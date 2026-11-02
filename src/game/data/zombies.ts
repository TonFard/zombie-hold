export type ZombieKind = 'walker' | 'runner' | 'bloater' | 'breaker' | 'colossus';

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
  },
};
