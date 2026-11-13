export type ZombieKind = 'walker' | 'runner' | 'bloater' | 'breaker' | 'colossus' | 'spitter' | 'screamer' | 'crawler' | 'armored' | 'leaper' | 'splitter' | 'gasser' | 'reaper' | 'brood' | 'siren';

/** 首领：每张地图一个（外围据点 巨像、荒野农场 收割者、湖畔营地 母巢、市区街道 哀嚎女王） */
export const BOSS_KINDS: readonly ZombieKind[] = ['colossus', 'reaper', 'brood', 'siren'];

/**
 * 首领技能。生命降到 phase2 以下进入二阶段：移动 ×rage、技能冷却缩短、解锁标了 p2 的技能。
 * 蓄力的技能地上都有预警；蓄力时被电击脉冲眩晕就放不出来
 */
export interface BossSkills {
  phase2: number;
  rage: number;
  /** 钩子：蓄力时锁定方向，然后按 speed 甩出去；钩中（离钩尖 width 米内）就把玩家拽到身前 */
  hook?: { range: number; min: number; windup: number; speed: number; width: number; damage: number; cd: number };
  /** 横扫：玩家贴近时蓄力，前方 ±arc 弧度、reach 米内的玩家和建筑吃伤害 */
  cleave?: { reach: number; arc: number; windup: number; damage: number; cd: number };
  /** 抛射：地上先出现 count 个预警圈，delay 秒后落下（碎石砸人 / 酸弹留酸池）。p2 = 二阶段才用 */
  lob?: { kind: 'rock' | 'acid'; range: number; count: number; spread: number; r: number; delay: number; damage: number; cd: number; p2: boolean };
  /** 孵化：每 every 秒从背上的卵囊里孵出 kind；从背后打身体打的是卵囊，每个囊 sacHp（× 最大生命），打爆一个少孵一只 */
  brood?: { kind: ZombieKind; every: number; sacs: number; sacHp: number };
  /** 尖啸：蓄力后 r 米内看得见的玩家受伤、被震慑 daze 秒（减速、晃屏），身边的僵尸加速 */
  shriek?: { r: number; windup: number; damage: number; daze: number; cd: number };
  /** 召唤：咆哮一声在身边叫出 count 只 kind */
  summon?: { kind: ZombieKind; count: number; cd: number; p2: boolean };
  /** 跳扑落地的震荡：周围 r 米的玩家吃伤害（越远越少） */
  quake?: { r: number; damage: number };
}

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
  /**
   * 头球：站着不动时球心高 y、沿朝向往前 fwd（米），半径 r。
   * 数值按程序僵尸（zombie-models.ts）量的。
   * move = 走 / 跑起来以后的位置（更低、更靠前），程序僵尸用不到；写实模型（?zombies=glb）驼背走路时才需要，按当前速度在两者之间过渡（hitvolume.ts 的 poseMoving）
   */
  head: { y: number; r: number; fwd: number; move?: { y: number; fwd: number } };
  /** 头部脆弱系数：1 = 吃满武器的爆头倍率，越小头越硬（头盔、装甲） */
  headVuln: number;
  /** 远程攻击（吐酸者）：射程、间隔；0 = 只会近战 */
  spitRange?: number;
  spitInterval?: number;
  /** 爆头一击必杀（吐酸者的酸囊） */
  headInstakill?: boolean;
  /** 尖叫（尖啸者）：半径、加速比例、持续、冷却 */
  scream?: { radius: number; boost: number; time: number; cd: number };
  /** 爬行者：能从路障下面钻过去（导航时路障对它几乎不算障碍，钻的时候减速） */
  crawl?: { slow: number };
  /**
   * 重装感染者：正面 ±arc 弧度内的子弹伤害 × front（背后、头、爆炸照常）。
   * 钢板有耐久：打在钢板上的原始伤害累计到 plate × 最大生命就掉下来，之后正面不再减伤
   */
  armor?: { arc: number; front: number; plate: number };
  /** 首领技能 */
  boss?: BossSkills;
  /** 冲锋（巨像，M13）：触发距离、蓄力、冲锋速度和时长、撞击伤害、硬直、冷却、冲完落地的震地（半径 / 伤害）、弱点（胸口）的高度 / 半径 / 倍率 */
  charge?: { range: number; windup: number; speed: number; time: number; damage: number; stun: number; cd: number; slam: { r: number; damage: number }; core: { y: number; r: number; mult: number } };
  /**
   * 跳跃者：扑人（玩家在 min–range 米内、中间只隔着矮的东西时）和跳过路障。
   * 蹲下蓄力 windup 秒，然后按 speed（米 / 秒）飞过去，弧顶离地 height；落地时玩家在身边就吃 damage。
   * cd = 扑人的冷却，hop = 跳路障的冷却
   */
  leap?: { range: number; min: number; windup: number; speed: number; height: number; damage: number; cd: number; hop: number };
  /** 裂殖者：打身体打死会裂成 count 只 kind（生命 ×hp）；爆头、炸死不裂 */
  split?: { kind: ZombieKind; count: number; hp: number };
  /**
   * 毒雾者：身边 aura 米内的玩家每秒掉 auraDps；死后留下半径 cloud、持续 life 秒的毒雾。
   * 烧死 / 炸死时毒气爆燃：半径 ignite.r 的爆炸只伤僵尸
   */
  gas?: { aura: number; auraDps: number; cloud: number; life: number; ignite: { r: number; damage: number } };
}

export const ZOMBIES: Record<ZombieKind, ZombieDef> = {
  // 瘦长、弓着腰。路障拦不住它，隔着 3–8 米会扑过来；蓄力时蹲下是打它的时机
  leaper: {
    kind: 'leaper',
    name: '跳跃者',
    hp: 48,
    speed: 2.3,
    radius: 0.3,
    damage: 8,
    attackInterval: 0.8,
    structMult: 0.5,
    reward: 6,
    aggro: 14,
    large: false,
    height: 1.8,
    head: { y: 1.58, r: 0.18, fwd: 0.14 },
    headVuln: 1,
    leap: { range: 8, min: 3, windup: 0.5, speed: 8, height: 1.5, damage: 14, cd: 5, hop: 1.5 },
  },
  // 肿得发紫、背上长满囊包。打身体打死会裂成 3 只小爬行者，爆头或炸死才干净
  splitter: {
    kind: 'splitter',
    name: '裂殖者',
    hp: 150,
    speed: 1.25,
    radius: 0.4,
    damage: 14,
    attackInterval: 1.1,
    structMult: 1.2,
    reward: 8,
    aggro: 8,
    large: false,
    height: 1.85,
    head: { y: 1.58, r: 0.2, fwd: 0.12 },
    headVuln: 1,
    split: { kind: 'crawler', count: 3, hp: 0.5 },
  },
  // 穿着破防化服的工人，罐子漏气。贴近了会被毒气熏，死后留一团毒雾；用火烧死毒气会爆燃，反过来炸一片
  gasser: {
    kind: 'gasser',
    name: '毒雾者',
    hp: 85,
    speed: 1.35,
    radius: 0.34,
    damage: 8,
    attackInterval: 1.0,
    structMult: 1,
    reward: 8,
    aggro: 10,
    large: false,
    height: 1.85,
    head: { y: 1.62, r: 0.19, fwd: 0.08 },
    // 戴着防毒面具
    headVuln: 0.85,
    gas: { aura: 2.2, auraDps: 4, cloud: 2.8, life: 7, ignite: { r: 3.6, damage: 130 } },
  },
  // M17：低矮、快、血薄。从路障下面钻过来、优先咬人；站着平射子弹从它头顶飞过去，要压低枪口
  crawler: {
    kind: 'crawler',
    name: '爬行者',
    hp: 36,
    speed: 2.15,
    radius: 0.3,
    damage: 8,
    attackInterval: 0.8,
    structMult: 0.5,
    reward: 4,
    aggro: 14,
    large: false,
    height: 0.7,
    head: { y: 0.35, r: 0.18, fwd: 0.5 },
    headVuln: 1,
    crawl: { slow: 0.45 },
  },
  // M17：正面挂着焊起来的钢板，正面打身体只有四成伤害。打头、绕后、用爆炸。
  // M20：定位是肉盾（生命 132 → 280，以前和破墙者差不多脆）；钢板能打掉，掉了正面就不再减伤
  armored: {
    kind: 'armored',
    name: '重装感染者',
    hp: 280,
    speed: 1.18,
    radius: 0.42,
    damage: 22,
    attackInterval: 1.3,
    structMult: 1.6,
    reward: 20,
    aggro: 8,
    large: false,
    height: 1.95,
    head: { y: 1.7, r: 0.2, fwd: 0.06 },
    headVuln: 1,
    armor: { arc: Math.PI / 3, front: 0.4, plate: 0.45 },
  },
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
  // 第一章首领。M20：生命 2400 → 3400、硬直 2.2 → 1.6 秒；半血以后狂暴，还会把碎石砸向躲在远处的玩家
  colossus: {
    kind: 'colossus',
    name: '巨像',
    hp: 3400,
    speed: 1.25,
    radius: 0.95,
    damage: 60,
    attackInterval: 1.25,
    structMult: 2,
    reward: 150,
    aggro: 12,
    large: true,
    height: 3.9,
    head: { y: 3.45, r: 0.38, fwd: 0.2 },
    // 首领的头有装甲，爆头收益只有一半多一点
    headVuln: 0.6,
    charge: { range: 16, windup: 1.2, speed: 8.5, time: 1.3, damage: 55, stun: 1.6, cd: 5, slam: { r: 3.4, damage: 28 }, core: { y: 2.4, r: 0.42, mult: 3 } },
    boss: { phase2: 0.5, rage: 1.3, lob: { kind: 'rock', range: 24, count: 3, spread: 2.4, r: 1.8, delay: 1.1, damage: 26, cd: 6.5, p2: true } },
  },
  // 第二章首领：瘦高的稻草人，麻袋套头、右臂是一把镰刀。开阔地上躲远了没用：钩子把人拽过来，接一刀横扫
  reaper: {
    kind: 'reaper',
    name: '收割者',
    hp: 3000,
    speed: 1.55,
    radius: 0.6,
    damage: 40,
    attackInterval: 1.0,
    structMult: 2,
    reward: 150,
    aggro: 30,
    large: true,
    height: 3.3,
    head: { y: 2.95, r: 0.3, fwd: 0.2 },
    headVuln: 0.6,
    boss: {
      phase2: 0.5,
      rage: 1.35,
      hook: { range: 16, min: 4, windup: 0.75, speed: 26, width: 0.75, damage: 18, cd: 7 },
      cleave: { reach: 3.6, arc: 1.2, windup: 0.7, damage: 38, cd: 2.5 },
      summon: { kind: 'runner', count: 4, cd: 14, p2: true },
    },
  },
  // 第三章首领：肿成一座山的母体，背上四个发光的卵囊不停地孵出爬行者，还会往远处吐酸弹。绕到背后打卵囊
  brood: {
    kind: 'brood',
    name: '母巢',
    hp: 3400,
    speed: 0.95,
    radius: 0.9,
    damage: 45,
    attackInterval: 1.3,
    structMult: 2,
    reward: 160,
    aggro: 10,
    large: true,
    height: 3.0,
    head: { y: 2.45, r: 0.3, fwd: 0.2 },
    headVuln: 0.6,
    boss: {
      phase2: 0.5,
      rage: 1.2,
      brood: { kind: 'crawler', every: 8, sacs: 4, sacHp: 0.07 },
      lob: { kind: 'acid', range: 18, count: 3, spread: 1.8, r: 1.6, delay: 1.0, damage: 16, cd: 6, p2: false },
    },
  },
  // 第四章首领：三米高的长发女人，四肢细长。尖啸震住人、远距离扑过来，半血以后叫来一群奔袭者。不算大体型：会追进屋里
  siren: {
    kind: 'siren',
    name: '哀嚎女王',
    hp: 2600,
    speed: 1.7,
    radius: 0.45,
    damage: 32,
    attackInterval: 0.9,
    structMult: 1.5,
    reward: 150,
    aggro: 24,
    large: false,
    height: 2.9,
    head: { y: 2.6, r: 0.26, fwd: 0.17 },
    headVuln: 0.65,
    leap: { range: 15, min: 5, windup: 0.8, speed: 11, height: 3.2, damage: 30, cd: 8, hop: 3 },
    boss: {
      phase2: 0.5,
      rage: 1.25,
      shriek: { r: 13, windup: 1.0, damage: 14, daze: 2.5, cd: 9 },
      summon: { kind: 'runner', count: 5, cd: 13, p2: true },
      quake: { r: 3.2, damage: 20 },
    },
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
