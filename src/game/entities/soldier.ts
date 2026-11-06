import type { WeaponKind } from '../data/weapons';

/** 5v5 团队死斗里的一个士兵（人机）。玩家自己不是 Soldier，用的还是 PlayerState */
export interface Soldier {
  id: number;
  /** 0 = 玩家这一队（蓝），1 = 敌队（红） */
  team: 0 | 1;
  name: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 身体朝向（走路方向）和视线（开枪方向），都是绕 Y，0 = 面向 +Z */
  yaw: number;
  aimYaw: number;
  aimPitch: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 死了以后多久复活 */
  respawnT: number;
  /** 出生无敌剩余时间 */
  spawnShield: number;
  weapon: WeaponKind;
  mag: number;
  reloadT: number;
  fireT: number;
  /** 连射了几发（压枪：越打越稳，然后后坐力把准星往上顶） */
  burst: number;
  crouch: boolean;
  walkPhase: number;
  kills: number;
  deaths: number;
  /** 最近一次开枪至今（画面上的枪口火光 / 后坐） */
  sinceShot: number;
  /** 最近一次被打至今（受击闪一下、AI 找掩体） */
  sinceHurt: number;
  // ---- AI ----
  brain: Brain;
}

/** 人机的"脑子"：反应延迟、注意力、记忆、当前意图 */
export interface Brain {
  /** 技术水平 0.6–1.2：越高反应越快、准星越稳 */
  skill: number;
  /** 当前锁定的目标（士兵 id，-1 = 玩家，null = 没有） */
  target: number | null;
  /** 看见目标后还要多久才开枪（反应时间） */
  reactT: number;
  /** 准星偏差（弧度）：看见目标时很大，持续瞄准慢慢收敛 */
  aimErrYaw: number;
  aimErrPitch: number;
  /** 最后一次看见 / 听见敌人的位置和时间（记忆，去那里搜） */
  lastSeenX: number;
  lastSeenZ: number;
  lastSeenT: number;
  /** 当前意图 */
  mode: 'advance' | 'fight' | 'cover' | 'search' | 'retreat';
  /** 要去的地方（导航目标）和路径 */
  goalX: number;
  goalZ: number;
  path: number[];
  pathT: number;
  /** 这一段意图还要持续多久（防止一帧一变） */
  modeT: number;
  /** 掩体点（躲在这里换弹 / 回血） */
  coverX: number;
  coverZ: number;
  /** 侧移（交火时左右晃，难打中）方向和剩余时间 */
  strafe: number;
  strafeT: number;
  /** 负责的路线：0 左翼 1 中路 2 右翼 */
  lane: number;
  /** 上次重新思考到现在 */
  thinkT: number;
}
