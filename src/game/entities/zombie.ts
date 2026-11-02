import { ZOMBIES, type ZombieDef, type ZombieKind } from '../data/zombies';

export type AttackTarget = 'none' | 'core' | 'player' | 'structure';

export class Zombie {
  readonly def: ZombieDef;
  readonly kind: ZombieKind;

  x: number;
  z: number;
  vx = 0;
  vz = 0;
  /** 朝向（绕 Y 轴，0 = 面向 +Z） */
  yaw = 0;

  hp: number;
  readonly maxHp: number;
  readonly radius: number;
  readonly speed: number;
  alive = true;

  goal: 'core' | 'player' = 'core';
  state: 'move' | 'attack' = 'move';
  attackTarget: AttackTarget = 'none';
  targetStructure = -1;
  attackTimer = 0.3;

  /** 当前要走向的路点 */
  hasWp = false;
  wpX = 0;
  wpZ = 0;
  /** 攻击时面向的点 */
  aimX = 0;
  aimZ = 0;

  /** 关闭分离力的剩余时间（脱困用） */
  noSepTimer = 0;
  sampleX: number;
  sampleZ: number;
  sampleTimer = 0;
  /** 当前采样窗口内受到邻居挤压的累计时间 */
  crowdTime = 0;
  stuckTime = 0;
  maxStuck = 0;

  everAttacked = false;
  /** 击退速度（格/秒），会快速衰减 */
  kbx = 0;
  kbz = 0;
  /** 灼烧剩余时间与每秒伤害 */
  burnT = 0;
  burnDps = 0;
  /** 渲染层使用 */
  hitFlash = 0;
  walkPhase = 0;
  readonly seed: number;

  constructor(
    readonly id: number,
    kind: ZombieKind,
    x: number,
    z: number,
    hpScale: number,
    seed: number,
  ) {
    this.kind = kind;
    this.def = ZOMBIES[kind];
    this.x = x;
    this.z = z;
    this.maxHp = Math.round(this.def.hp * hpScale);
    this.hp = this.maxHp;
    this.radius = this.def.radius;
    // 速度有 ±10% 的个体差异，避免队伍挤成一团
    this.speed = this.def.speed * (0.9 + (seed % 1000) / 5000);
    this.sampleX = x;
    this.sampleZ = z;
    this.seed = seed;
  }
}
