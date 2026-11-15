import type { GunCat } from '../data/guns';
import type { WeaponKind } from '../data/weapons';

/** 8v8 对战里的一个士兵（人机）。玩家自己不是 Soldier，用的还是 PlayerState */
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
  /** 手里的枪：型号（data/guns.ts 的 id）和它的枪类 */
  gun: string;
  weapon: WeaponKind;
  /** 金币、护甲（0–100）、头盔 */
  money: number;
  armor: number;
  helmet: boolean;
  /** 爱买哪一类枪 */
  taste: GunCat;
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
  /** 脚离地多高（米）：跳起来、站在箱子上；竖直速度 */
  y: number;
  vy: number;
  /** 手里这把枪的备弹 */
  reserve: number;
  /** 身上的另一把枪（手里是主武器时它是手枪，换成手枪以后它是主武器）；没有就是 null */
  alt: { gun: string; mag: number; reserve: number } | null;
  /** 手里拿的是刀（枪收起来了） */
  knife: boolean;
  /** 挥刀：开始挥到现在多久（秒；< 0 = 没在挥）和哪一种（0 = 从右往左横挥，1 = 从左往右，2 = 捅） */
  meleeT: number;
  meleeKind: 0 | 1 | 2;
  /** 身上的手雷；正在扔：抬手还剩多久（> 0 = 手里攥着雷，到 0 出手） */
  nades: number;
  throwT: number;
  /** 掏枪 / 换枪还要多久才能开火 */
  drawT: number;
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
  /** 走哪条路（map-warehouse 的 ROUTES 下标）、下一个要到的点、顺着走还是倒着走 */
  lane: number;
  wp: number;
  dir: 1 | -1;
  /** 开局先站一会儿再走（大家不同时起步，不然挤成一串）；蹲点的时候也用它 */
  holdT: number;
  /** 这一局打算在自己半场的路口蹲多久（秒）再往前压；0 = 直接冲。到了路口就把它换成 holdT */
  camp: number;
  /** 上次重新思考到现在 */
  thinkT: number;
  /** 灵活的人：会翻过矮掩体抄近路、挨打的时候跳着躲 */
  agile: boolean;
  /** 这一帧想跳；顶着东西走不动多久了 */
  jump: boolean;
  stuckT: number;
  /** 要去捡的那把枪（掉在地上的枪的 id）；多久以后再找一次 */
  loot: number | null;
  lootT: number;
  /** 人躲到掩体后面了，打算往那扔一颗雷；扔的方向 */
  wantNade: boolean;
  nadeYaw: number;
  nadePitch: number;
  /** 多久以后才再考虑一次要不要躲（免得每一帧都掷骰子）；刚躲过一颗雷，多久以后才再躲 */
  coverT: number;
  fleeT: number;
  /** 对这个目标瞄头还是瞄胸口（看见的时候定下来） */
  headAim: boolean;
}
