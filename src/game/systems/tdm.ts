import { clamp } from '../core/math';
import { zeroPitch } from '../data/ballistics';
import { GUN_BY_ID, catOf, defaultGuns, type GunCat, type GunDef } from '../data/guns';
import { NO_META } from '../config';
import { ARENA_TIER, ARMOR, DEFAULT_PISTOL, ECON, GEAR, KILL_REWARD, KNIFE, NADE, arenaStats, lossBonus, priceOf, reserveFor, shelf, throughArmor, vsHuman, type GearId } from '../data/shop';
import { WEAPONS, WEAPON_ORDER, falloffAt, noMods, type WeaponKind } from '../data/weapons';
import type { Brain, Soldier } from '../entities/soldier';
import { defaultMods, type Game } from '../sim';
import { resolveCircleVsGrid } from '../world/collision';
import { GRID_W, HALF_H, HALF_W } from '../world/grid';
import { BUY_ZONE, ROUTES, ROUTE_OF, arenaSpawns } from '../world/map-warehouse';
import { obstruction } from './combat';
import { segCylinder, segSphere } from './hitvolume';
import { JUMP, arcClear, dropGun, grounded, knifeHit, lobPitch, passAbove, refillPlayer, soldierPickup, stepVertical, throwNade, topAt, updateNades } from './tdm-gear';

/**
 * 8v8 回合制对战（单机）：玩家 + 7 个队友人机 对 8 个敌方人机，地图「北港仓库」。
 *
 * 一局（回合）：冻结时间（站在出生点买枪）→ 开打，不复活；把对面打光就赢，时间到了按剩下的人数算。
 * 先赢 TDM.winRounds 局的队伍赢下整场；打完 TDM.half 局换边，钱和枪全部重来。
 * 钱：赢一局、输一局、每个击杀都给（data/shop.ts）；活到下一局的人枪和护甲带着走，死了只剩一把默认手枪。
 * 人机也各有各的钱：钱够就买自己爱用的那类枪 + 护甲，不够就凑一把便宜的或者攒一局。
 *
 * 人机"像真人"靠的是这几件事：
 *   - 反应时间：看见敌人后要 0.2–0.5 秒（按技术水平）才开第一枪，背对时更慢；
 *   - 准星误差：刚看见时偏差很大，持续瞄准慢慢收敛；连射时后坐力把准星往上顶，过几发才压住；
 *   - 有记忆：看不见了会去最后看见 / 听见枪声的地方搜，而不是忘掉；
 *   - 交火时左右横移、蹲下，残血或换弹时找掩体躲；
 *   - 分路：每个人走一条路（堆场 / 库房 / 后巷 / 办公楼），队友之间有间距，不会挤成一团。
 */
export const TDM = {
  /** 每队几个人 */
  size: 8,
  /** 先赢几局；打完第几局换边；最多打几局（打满了按局数多的算） */
  winRounds: 8,
  half: 7,
  maxRounds: 15,
  /** 冻结时间、开打后还能在出生区买多久、一局多长、打完停多久再开下一局（秒） */
  freeze: 12,
  buyLive: 15,
  roundTime: 150,
  endPause: 6,
  /** 开打这么久还没打完，人机就知道剩下的人大概在哪（当作队友报点），不会满图乱转 */
  huntAfter: 45,
  hp: 100,
  /** 视野：最远看见距离（米）、视野半角（弧度，正前方 ±80°）、听见枪声的距离 */
  sight: 46,
  fov: (80 * Math.PI) / 180,
  hear: 30,
  speed: 3.6,
  /** 士兵的身体：半径、高度、头 */
  radius: 0.32,
  height: 1.75,
  headY: 1.62,
  headR: 0.13,
};

/**
 * 人机的水平（两队的人机都按它来，蓝队的队友和红队的敌人一样强）：
 *   skill  = 每个人技术水平的范围（反应、转枪口、准星收敛都跟着它）；
 *   react  = 反应时间的倍率；damage = 人机子弹的伤害倍率（人机不会找角度、不会配合，低档给它的枪打个折）；
 *   head   = 瞄头的可能；cover = 换弹 / 挨打 / 残血时去找掩体的可能；
 *   nade   = 买雷、人躲起来以后往掩体后面扔雷的可能；agile = 会翻掩体、跳着躲的人占多少
 */
export const LEVELS = [
  { name: '普通', skill: [0.55, 0.95], react: 1.25, damage: 0.75, head: 0.1, cover: 0.5, nade: 0.25, agile: 0.3 },
  { name: '困难', skill: [0.8, 1.25], react: 0.9, damage: 0.9, head: 0.3, cover: 0.8, nade: 0.6, agile: 0.6 },
  { name: '专家', skill: [1.0, 1.45], react: 0.7, damage: 1, head: 0.5, cover: 0.95, nade: 0.85, agile: 0.85 },
] as const;
const LV = (g: Game): (typeof LEVELS)[number] => LEVELS[g.tdm.level] as (typeof LEVELS)[number];

/** 人机开火的最远距离（占射程的比例）：近战枪要贴近再打，不在射程边缘放空枪 */
const FIRE_AT: Partial<Record<WeaponKind, number>> = { smg: 1.05, shotgun: 0.85, pistol: 0.9 };

const NAMES = ['老鹰', '石头', '野狼', '幽灵', '铁锤', '飞鱼', '孤狼', '火狐', '冰刃', '夜枭', '黑熊', '雷霆', '山猫', '影子', '北风', '刺猬', '猎犬', '灰熊', '鹰眼', '疾风'];

/**
 * 人机钱够的时候爱买哪一类枪：权重。冲锋枪、霰弹枪主要是没钱时凑合用的（botBuy 里另算），
 * 这里只留一点，场上才不全是步枪
 */
const TASTES: Array<[GunCat, number]> = [
  ['rifle', 52],
  ['dmr', 14],
  ['sniper', 12],
  ['lmg', 10],
  ['smg', 7],
  ['shotgun', 5],
];

export type RoundPhase = 'freeze' | 'live' | 'end';

export interface TdmState {
  on: boolean;
  soldiers: Soldier[];
  /** 两队各赢了几局 */
  score: [number, number];
  /** 第几局（从 1 开始） */
  round: number;
  phase: RoundPhase;
  /** 这个阶段还剩多久 */
  phaseT: number;
  /** 这一局开打了多久 */
  liveT: number;
  /** 换过边了：蓝队到北边出生 */
  swapped: boolean;
  /** 两队各连输了几局 */
  lossStreak: [number, number];
  /** 刚打完的这一局谁赢的、怎么赢的（-1 = 平） */
  roundWinner: -1 | 0 | 1;
  roundReason: string;
  over: boolean;
  winner: -1 | 0 | 1;
  // ---- 玩家 ----
  money: number;
  armor: number;
  helmet: boolean;
  /** 上一局结束时发了多少钱（界面上显示一下） */
  income: number;
  playerKills: number;
  playerDeaths: number;
  /** 死了以后看谁的镜头（士兵 id）；null = 还在看自己倒下的地方 */
  spectate: number | null;
  deadT: number;
  fireHeld: boolean;
  /** 击杀信息（右上角滚动） */
  feed: Array<{ killer: string; victim: string; kt: 0 | 1; vt: 0 | 1; gun: string; head: boolean; t: number }>;
  /** 人机的水平：0 = 普通，1 = 困难，2 = 专家 */
  level: 0 | 1 | 2;
  /** 掉在地上的枪（死了的人掉的、捡枪时换下来的），这一局结束清掉。t = 掉下来多久了，y0 = 从多高掉下来 */
  drops: DroppedGun[];
  nextDropId: number;
  /** 玩家走到哪把掉在地上的枪边上了（按 E 捡）；没有就是 null */
  pickup: number | null;
  /** 飞在空中 / 在地上滚的手雷（owner = 士兵 id，-1 = 玩家） */
  grenades: TdmGrenade[];
  /** 玩家每类枪的备弹 */
  reserve: Record<WeaponKind, number>;
  /** 玩家身上的手雷 */
  nades: number;
  /** 玩家手里拿的是刀 */
  knife: boolean;
  /**
   * 玩家挥刀：swingT = 开始挥到现在多久（秒；< 0 = 没在挥），swingDur = 这一下多长，
   * swingKind = 0 从右往左横挥 / 1 从左往右 / 2 捅；swingQuick = 手里拿着枪按 V 抽刀挥的（挥完枪回来）
   */
  swingT: number;
  swingDur: number;
  swingKind: 0 | 1 | 2;
  swingQuick: boolean;
  /** 这一下已经结算过命中了；跳的冷却 */
  swingHit: boolean;
  jumpCd: number;
}

export interface TdmGrenade {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  owner: number;
  team: 0 | 1;
}

export interface DroppedGun {
  id: number;
  gun: string;
  x: number;
  z: number;
  yaw: number;
  mag: number;
  reserve: number;
  t: number;
  y0: number;
}

export const newTdm = (): TdmState => ({
  on: false,
  soldiers: [],
  score: [0, 0],
  round: 1,
  phase: 'freeze',
  phaseT: TDM.freeze,
  liveT: 0,
  swapped: false,
  lossStreak: [0, 0],
  roundWinner: -1,
  roundReason: '',
  over: false,
  winner: -1,
  money: ECON.start,
  armor: 0,
  helmet: false,
  income: 0,
  playerKills: 0,
  playerDeaths: 0,
  spectate: null,
  deadT: 0,
  fireHeld: false,
  feed: [],
  level: 1,
  drops: [],
  nextDropId: 1,
  pickup: null,
  grenades: [],
  reserve: { pistol: 0, smg: 0, shotgun: 0, rifle: 0, sniper: 0, lmg: 0 },
  nades: 0,
  knife: false,
  swingT: -1,
  swingDur: 0.5,
  swingKind: 0,
  swingQuick: false,
  swingHit: false,
  jumpCd: 0,
});

export const PLAYER = -1;
/** 敌人目标：士兵或玩家 */
interface Tgt {
  id: number;
  team: 0 | 1;
  x: number;
  z: number;
  /** 脚离地多高；眼睛的高度（已经算上脚的高度） */
  y: number;
  eye: number;
  alive: boolean;
}

function targets(g: Game): Tgt[] {
  const out: Tgt[] = [];
  const p = g.player;
  out.push({ id: PLAYER, team: 0, x: p.x, z: p.z, y: p.air, eye: p.eye + p.air, alive: p.alive });
  for (const s of g.tdm.soldiers) out.push({ id: s.id, team: s.team, x: s.x, z: s.z, y: s.y, eye: (s.crouch ? 1.1 : TDM.headY) + s.y, alive: s.alive });
  return out;
}

/** 这一队现在在哪一边出生：0 = 南，1 = 北 */
const sideOf = (g: Game, team: 0 | 1): 0 | 1 => (g.tdm.swapped ? ((1 - team) as 0 | 1) : team);

/** 两队还活着几个（玩家算蓝队） */
export function aliveCount(g: Game): [number, number] {
  const n: [number, number] = [g.player.alive ? 1 : 0, 0];
  for (const s of g.tdm.soldiers) if (s.alive) n[s.team]++;
  return n;
}

const newBrain = (g: Game): Brain => ({
  skill: 0.65 + g.rng.next() * 0.5,
  target: null,
  reactT: 0,
  aimErrYaw: 0,
  aimErrPitch: 0,
  lastSeenX: 0,
  lastSeenZ: 0,
  lastSeenT: -99,
  mode: 'advance',
  goalX: 0,
  goalZ: 0,
  path: [],
  pathT: 0,
  modeT: 0,
  coverX: 0,
  coverZ: 0,
  strafe: 1,
  strafeT: 0,
  lane: 0,
  wp: 0,
  dir: 1,
  holdT: 0,
  camp: 0,
  thinkT: 0,
  agile: false,
  jump: false,
  stuckT: 0,
  loot: null,
  lootT: 0,
  wantNade: false,
  nadeYaw: 0,
  nadePitch: 0,
  coverT: 0,
  fleeT: 0,
  headAim: false,
});

function pickTaste(g: Game): GunCat {
  let r = g.rng.next() * TASTES.reduce((a, [, w]) => a + w, 0);
  for (const [cat, w] of TASTES) {
    r -= w;
    if (r <= 0) return cat;
  }
  return 'rifle';
}

/** 开一场：生成 7 个队友 + 8 个敌人，第一局开始 */
export function startTdm(g: Game): void {
  const t = g.tdm;
  const level = t.level;
  Object.assign(t, newTdm());
  t.level = level;
  t.on = true;
  g.zombies.length = 0;
  // 对战不吃任何局外加成：大厅里买的血量 / 护甲 / 移速 / 射速、工作台的改装、枪的星级、卡牌、限量的子弹，一样都不带进来。
  // 所有人（包括人机）都是 100 血、同一套枪的数值，枪和护甲只能在局里用金币买
  Object.assign(g.mods, defaultMods());
  g.config.meta = { ...NO_META };
  g.config.weaponMods = noMods();
  g.config.stars = { pistol: 0, smg: 0, shotgun: 0, rifle: 0, sniper: 0, lmg: 0 };
  g.config.extras = false;
  g.config.ammo = false;
  g.player.maxHp = TDM.hp;
  g.player.maxStamina = 100;
  g.player.stamina = 100;
  const names = [...NAMES].sort(() => g.rng.next() - 0.5);
  // 两队的人一一对应：技术水平一样、爱用的枪也是同一类（位置错开，不走同一条路），整场下来才是五五开。
  // 蓝队少的那一个是玩家
  const L = LV(g);
  const skills = Array.from({ length: TDM.size }, () => L.skill[0] + g.rng.next() * (L.skill[1] - L.skill[0]));
  const tastes = Array.from({ length: TDM.size }, () => pickTaste(g));
  const agiles = Array.from({ length: TDM.size }, () => g.rng.next() < L.agile);
  let n = 0;
  for (const team of [0, 1] as const) {
    const count = team === 0 ? TDM.size - 1 : TDM.size;
    for (let i = 0; i < count; i++) {
      const twin = team === 0 ? i + 1 : (i + 3) % TDM.size;
      const s: Soldier = {
        id: 1000 + n,
        team,
        name: names[n++ % names.length] as string,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        yaw: 0,
        aimYaw: 0,
        aimPitch: 0,
        hp: TDM.hp,
        maxHp: TDM.hp,
        alive: false,
        gun: DEFAULT_PISTOL,
        weapon: 'pistol',
        money: ECON.start,
        armor: 0,
        helmet: false,
        taste: tastes[twin] as GunCat,
        mag: arenaStats(DEFAULT_PISTOL).mag,
        reloadT: 0,
        fireT: 0,
        burst: 0,
        crouch: false,
        walkPhase: 0,
        kills: 0,
        deaths: 0,
        sinceShot: 9,
        sinceHurt: 9,
        y: 0,
        vy: 0,
        reserve: 0,
        alt: null,
        knife: false,
        meleeT: -1,
        meleeKind: 0,
        nades: 0,
        throwT: 0,
        drawT: 0,
        brain: newBrain(g),
      };
      s.brain.skill = skills[twin] as number;
      s.brain.agile = agiles[twin] as boolean;
      t.soldiers.push(s);
    }
  }
  g.player.alive = false;
  beginRound(g);
}

// ---------------------------------------------------------------- 玩家的枪

export function holdWeapon(g: Game, kind: WeaponKind): void {
  const p = g.player;
  p.weapon = kind;
  p.tier = ARENA_TIER;
  p.reloadTimer = 0;
  p.fireTimer = 0.25;
  p.ramp = 0;
  p.ads = 0;
  g.events.emit('weaponSwitch', { kind });
}

/** 玩家身上的主武器（没有就是 null） */
export function playerPrimary(g: Game): WeaponKind | null {
  return WEAPON_ORDER.find((k) => k !== 'pistol' && g.loadout[k].owned) ?? null;
}

/** 玩家只剩一把默认手枪 */
function resetPlayerLoadout(g: Game): void {
  g.config.guns = defaultGuns();
  g.config.guns.pistol = DEFAULT_PISTOL;
  for (const k of WEAPON_ORDER) {
    const slot = g.loadout[k];
    slot.owned = slot.carried = k === 'pistol';
    slot.tier = ARENA_TIER;
  }
  g.tdm.armor = 0;
  g.tdm.helmet = false;
  holdWeapon(g, 'pistol');
}

/** 现在能不能买东西：冻结时间里随便买；开打后的头十几秒，人还在出生区也行 */
export function canBuy(g: Game): boolean {
  const t = g.tdm;
  if (!t.on || t.over || !g.player.alive) return false;
  if (t.phase === 'freeze') return true;
  if (t.phase !== 'live' || t.liveT > TDM.buyLive) return false;
  const [y0, y1] = BUY_ZONE[sideOf(g, 0)] as readonly [number, number];
  const cy = g.grid.cellY(g.player.z);
  return cy >= y0 && cy <= y1;
}

export type BuyResult = 'ok' | 'closed' | 'money' | 'owned';

/** 玩家买一把枪：手枪换掉身上的手枪，别的换掉身上的主武器（旧的不退钱） */
export function buyGun(g: Game, id: string): BuyResult {
  const t = g.tdm;
  const gun = GUN_BY_ID[id];
  if (!gun || !canBuy(g)) return 'closed';
  const cls = gun.cls;
  if (g.loadout[cls].owned && g.config.guns[cls] === id) return 'owned';
  const price = priceOf(id);
  if (t.money < price) return 'money';
  t.money -= price;
  if (cls !== 'pistol') {
    for (const k of WEAPON_ORDER) if (k !== 'pistol' && k !== cls) g.loadout[k].owned = g.loadout[k].carried = false;
  }
  g.config.guns[cls] = id;
  const slot = g.loadout[cls];
  slot.owned = slot.carried = true;
  slot.tier = ARENA_TIER;
  slot.mag = g.statsOf(cls, ARENA_TIER).mag;
  t.reserve[cls] = reserveFor(id);
  t.knife = false;
  holdWeapon(g, cls);
  g.events.emit('tdmBuy', { id });
  return 'ok';
}

/** 玩家买护甲 / 手雷 */
export function buyGear(g: Game, id: GearId): BuyResult {
  const t = g.tdm;
  if (!canBuy(g)) return 'closed';
  if (id === 'vest' ? t.armor >= ARMOR.max : id === 'helmet' ? t.helmet : t.nades >= NADE.max) return 'owned';
  const price = GEAR[id].price;
  if (t.money < price) return 'money';
  t.money -= price;
  if (id === 'vest') t.armor = ARMOR.max;
  else if (id === 'helmet') t.helmet = true;
  else t.nades++;
  g.events.emit('tdmBuy', { id });
  return 'ok';
}

// ---------------------------------------------------------------- 人机买枪

const giveGun = (s: Soldier, id: string): void => {
  const cls = (GUN_BY_ID[id] as GunDef).cls;
  // 买了主武器：原来手里的手枪收到身上（主武器打光了再掏出来）
  if (cls !== 'pistol' && s.weapon === 'pistol') s.alt = { gun: s.gun, mag: s.mag, reserve: s.reserve };
  s.gun = id;
  s.weapon = cls;
  s.mag = arenaStats(id).mag;
  s.reserve = reserveFor(id);
  s.reloadT = 0;
  s.knife = false;
};

/** 手里的枪和身上的另一把对调 */
function swapAlt(s: Soldier): void {
  const alt = s.alt;
  if (!alt) return;
  s.alt = { gun: s.gun, mag: s.mag, reserve: s.reserve };
  s.gun = alt.gun;
  s.weapon = (GUN_BY_ID[alt.gun] as GunDef).cls;
  s.mag = alt.mag;
  s.reserve = alt.reserve;
  s.reloadT = 0;
  s.burst = 0;
  s.drawT = 0.45;
  s.knife = false;
}

/** 弹匣打空了：身上另一把枪还有子弹、敌人又近，就换枪（比换弹快）；不然换弹；什么子弹都没了就拔刀 */
function emptied(g: Game, s: Soldier, near: boolean): void {
  const alt = s.alt;
  if (alt && alt.mag > 0 && (near || s.reserve <= 0)) swapAlt(s);
  else if (s.reserve > 0) s.reloadT = arenaStats(s.gun).reload * (1.05 + g.rng.next() * 0.2);
  else if (alt && alt.mag + alt.reserve > 0) swapAlt(s);
  else s.knife = true;
}

/** 这一类里买得起的：从最贵的两三把里随便挑一把（每个人不会都拿同一把） */
function affordable(g: Game, cat: GunCat, budget: number): string | null {
  const ok = shelf(cat).filter((r) => r.price <= budget && r.price > 0);
  if (!ok.length) return null;
  const top = ok.slice(-3);
  return (top[g.rng.int(0, top.length - 1)] as { gun: GunDef }).gun.id;
}

/**
 * 这一局全队是买还是攒（像真人队伍那样一起决定，不是各买各的——各买各的结果就是一半人拿冲锋枪、一半人拿手枪，局局输）。
 * 手枪局、钱够起全枪：买。钱不够、但攒一局下一局就够：多半攒着；半场 / 整场的最后一局、已经连输三局以上就不攒了
 */
function teamPlan(g: Game, team: 0 | 1): 'buy' | 'save' {
  const t = g.tdm;
  const need = t.soldiers.filter((s) => s.team === team && !(s.alive && s.weapon !== 'pistol'));
  if (!need.length) return 'buy';
  const avg = need.reduce((a, s) => a + s.money, 0) / need.length;
  if (avg <= ECON.start + 200) return 'save';
  if (avg >= 3300) return 'buy';
  const last = t.round === TDM.half || Math.max(t.score[0], t.score[1]) >= TDM.winRounds - 1;
  const next = avg + lossBonus(t.lossStreak[team] + 1);
  if (!last && avg < 2300 && next >= 3600 && t.lossStreak[team] <= 2 && g.rng.next() < 0.7) return 'save';
  return 'buy';
}

/**
 * 人机在冻结时间里买东西。kept = 上一局活下来了，手里的枪还在；plan = 全队这一局买还是攒。
 * 买：自己爱用的那一类里挑一把好的 + 防弹衣 + 头盔；不够就不要头盔、再不够就换便宜的步枪，最后才是冲锋枪 / 霰弹枪；
 * 攒：手枪局买件防弹衣或者换把好点的手枪，别的时候什么都不买。
 */
function botBuy(g: Game, s: Soldier, kept: boolean, plan: 'buy' | 'save'): void {
  const armorUp = (): void => {
    if (s.armor < 50 && s.money >= GEAR.vest.price) {
      s.money -= GEAR.vest.price;
      s.armor = ARMOR.max;
    }
    if (!s.helmet && s.armor > 0 && s.money >= GEAR.helmet.price) {
      s.money -= GEAR.helmet.price;
      s.helmet = true;
    }
    // 钱有富余再带一颗雷
    if (plan === 'buy' && s.nades < NADE.max && s.money >= GEAR.nade.price + 400 && g.rng.next() < LV(g).nade) {
      s.money -= GEAR.nade.price;
      s.nades++;
    }
  };
  if (kept && s.weapon !== 'pistol') {
    armorUp();
    return;
  }
  if (plan === 'buy') {
    const vest = s.armor < 50 ? GEAR.vest.price : 0;
    const full = vest + (s.helmet ? 0 : GEAR.helmet.price);
    const cheap: GunCat = g.rng.next() < 0.7 ? 'smg' : 'shotgun';
    const id = affordable(g, s.taste, s.money - full) ?? affordable(g, s.taste, s.money - vest) ?? affordable(g, 'rifle', s.money - vest) ?? affordable(g, cheap, s.money - vest) ?? affordable(g, cheap, s.money);
    if (id) {
      s.money -= priceOf(id);
      giveGun(s, id);
    }
    armorUp();
    if (id) return;
  }
  // 手枪局 / 攒钱局
  const r = g.rng.next();
  if (s.money <= ECON.start + 200) {
    if (r < 0.5) armorUp();
    else if (r < 0.8) {
      const pistol = affordable(g, 'pistol', s.money);
      if (pistol) {
        s.money -= priceOf(pistol);
        giveGun(s, pistol);
      }
    }
  } else if (r < 0.3 && s.gun === DEFAULT_PISTOL) {
    const pistol = affordable(g, 'pistol', Math.min(700, s.money - 1000));
    if (pistol) {
      s.money -= priceOf(pistol);
      giveGun(s, pistol);
    }
  }
}

// ---------------------------------------------------------------- 回合

/** 开一局：所有人回出生点、回满血，活下来的带着枪，死了的只剩手枪；人机买枪 */
function beginRound(g: Game): void {
  const t = g.tdm;
  const p = g.player;
  t.phase = 'freeze';
  t.phaseT = TDM.freeze;
  t.liveT = 0;
  t.roundWinner = -1;
  t.roundReason = '';
  t.spectate = null;
  t.deadT = 0;
  g.bullets.length = 0;
  t.drops = [];
  t.grenades = [];
  t.pickup = null;

  const slots: [number, number] = [0, 0];
  const plan = [teamPlan(g, 0), teamPlan(g, 1)] as const;
  for (const s of t.soldiers) {
    const side = sideOf(g, s.team);
    // 蓝队的 3 号位留给玩家（正对库房大门）
    let slot = slots[s.team]++;
    if (s.team === 0 && slot >= 3) slot++;
    const sp = arenaSpawns(g.map, side)[slot % TDM.size]!;
    const kept = s.alive;
    if (!kept) {
      s.alt = null;
      s.weapon = 'pistol';
      giveGun(s, DEFAULT_PISTOL);
      s.armor = 0;
      s.helmet = false;
      s.nades = 0;
    } else if (s.weapon === 'pistol' && s.alt) swapAlt(s);
    s.y = 0;
    s.vy = 0;
    s.knife = false;
    s.meleeT = -1;
    s.throwT = 0;
    s.drawT = 0;
    s.x = sp.x + (g.rng.next() - 0.5) * 0.6;
    s.z = sp.z + (g.rng.next() - 0.5) * 0.6;
    s.vx = s.vz = 0;
    s.yaw = s.aimYaw = side === 0 ? Math.PI : 0;
    s.aimPitch = 0;
    s.hp = s.maxHp;
    s.alive = true;
    s.crouch = false;
    s.burst = 0;
    s.fireT = 0;
    s.sinceShot = 9;
    s.sinceHurt = 9;
    s.reloadT = 0;
    const br = s.brain;
    br.target = null;
    br.mode = 'advance';
    br.path = [];
    br.pathT = 0;
    br.modeT = 0;
    br.lastSeenT = -99;
    br.loot = null;
    br.wantNade = false;
    br.jump = false;
    br.stuckT = 0;
    br.coverT = 0;
    br.fleeT = 0;
    br.lane = ROUTE_OF[slot % ROUTE_OF.length] as number;
    br.dir = side === 0 ? 1 : -1;
    br.wp = side === 0 ? 0 : (ROUTES[br.lane] as ReadonlyArray<unknown>).length - 1;
    br.holdT = g.rng.next() * 1.4;
    // 四成的人这一局先在自己半场的路口架一会儿枪，等对面过来；剩下的直接往前压（每局重新抽，打法不固定）
    br.camp = g.rng.next() < 0.4 ? 10 + g.rng.next() * 16 : 0;
    botBuy(g, s, kept, plan[s.team]);
    // 每局开始弹匣、备弹补满
    s.mag = arenaStats(s.gun).mag;
    s.reserve = reserveFor(s.gun);
    if (s.alt) {
      s.alt.mag = arenaStats(s.alt.gun).mag;
      s.alt.reserve = reserveFor(s.alt.gun);
    }
    // 拿什么枪走什么路：近战枪进库房 / 办公楼，狙击枪去堆场 / 后巷那两条长的（不是每次都换，免得一条路上挤满人）
    const indoor = br.lane === 1 || br.lane === 3;
    if ((s.weapon === 'smg' || s.weapon === 'shotgun') && !indoor && g.rng.next() < 0.7) br.lane = g.rng.next() < 0.6 ? 1 : 3;
    else if (s.weapon === 'sniper' && indoor && g.rng.next() < 0.7) br.lane = g.rng.next() < 0.5 ? 0 : 2;
  }

  // 玩家
  const kept = p.alive;
  if (!kept) resetPlayerLoadout(g);
  if (!kept) t.nades = 0;
  t.knife = false;
  t.swingT = -1;
  g.hz.throwT = 0;
  refillPlayer(g);
  const side = sideOf(g, 0);
  const sp = arenaSpawns(g.map, side)[3]!;
  p.x = sp.x;
  p.z = sp.z;
  p.yaw = side === 0 ? Math.PI : 0;
  p.hp = p.maxHp;
  p.alive = true;
  p.vx = p.vz = 0;
  p.air = 0;
  p.vy = 0;
  p.meleeTimer = 0;
  p.reloadTimer = 0;
  p.kickPitch = 0;
  p.kickYaw = 0;
  g.events.emit('tdmRespawn', { yaw: p.yaw });
  g.events.emit('tdmRound', { stage: 'freeze', round: t.round, winner: -1, reason: '', income: t.income });
}

/** 这一局打完了：记分、发钱 */
function endRound(g: Game, winner: -1 | 0 | 1, reason: string): void {
  const t = g.tdm;
  t.phase = 'end';
  t.phaseT = TDM.endPause;
  t.roundWinner = winner;
  t.roundReason = reason;
  const pay: [number, number] = [ECON.loss, ECON.loss];
  if (winner !== -1) {
    const loser = (1 - winner) as 0 | 1;
    t.score[winner]++;
    t.lossStreak[winner] = 0;
    t.lossStreak[loser]++;
    pay[winner] = ECON.win;
    pay[loser] = lossBonus(t.lossStreak[loser]);
  }
  for (const s of t.soldiers) s.money = Math.min(ECON.cap, s.money + pay[s.team]);
  t.income = pay[0];
  t.money = Math.min(ECON.cap, t.money + pay[0]);
  g.events.emit('tdmRound', { stage: 'end', round: t.round, winner, reason, income: pay[0] });
}

/** 换边：两队交换出生点，钱、枪、护甲、连输全部重来 */
function halftime(g: Game): void {
  const t = g.tdm;
  t.swapped = true;
  t.lossStreak = [0, 0];
  t.money = ECON.start;
  t.income = 0;
  for (const s of t.soldiers) {
    s.money = ECON.start;
    s.alive = false;
  }
  g.player.alive = false;
  g.events.emit('tdmRound', { stage: 'half', round: t.round, winner: -1, reason: '', income: 0 });
}

// ---------------------------------------------------------------- 寻路（格子 BFS，人机少，够用）

const _dist = new Int32Array(GRID_W * GRID_W);
const _queue = new Int32Array(GRID_W * GRID_W);
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** 一下能跳上去的高度（箱子、托盘、沙袋、水泥墩、油桶） */
const HOP_MAX = 1.05;

/**
 * 从 (x0,z0) 到 (x1,z1) 的格子路径（不含起点），走不到返回空。
 * hop = 这个人会翻掩体：一米以内的矮东西当成能走的格子（走到跟前跳上去，从上面过）
 */
function findPath(g: Game, x0: number, z0: number, x1: number, z1: number, hop = false): number[] {
  const grid = g.grid;
  const start = grid.indexAt(x0, z0);
  const goal = grid.indexAt(x1, z1);
  if (start === goal) return [];
  _dist.fill(-1);
  let head = 0;
  let tail = 0;
  _queue[tail++] = goal;
  _dist[goal] = goal;
  while (head < tail) {
    const u = _queue[head++] as number;
    if (u === start) break;
    const ux = u % GRID_W;
    const uy = (u / GRID_W) | 0;
    for (let k = 0; k < 8; k++) {
      const dx = DX[k] as number;
      const dy = DY[k] as number;
      const nx = ux + dx;
      const ny = uy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const v = ny * GRID_W + nx;
      if (_dist[v] !== -1) continue;
      if (v !== start && grid.isBlocked(nx, ny)) {
        const top = hop ? topAt(g, nx, ny) : 0;
        if (top <= 0 || top > HOP_MAX) continue;
      }
      // 斜着走不能切墙角
      if (dx && dy && (grid.isBlocked(ux + dx, uy) || grid.isBlocked(ux, uy + dy))) continue;
      _dist[v] = u;
      _queue[tail++] = v;
    }
  }
  if (_dist[start] === -1) return [];
  const out: number[] = [];
  let c = _dist[start] as number;
  for (let i = 0; i < 400 && c !== goal; i++) {
    out.push(c);
    c = _dist[c] as number;
  }
  out.push(goal);
  return out;
}

const cellWX = (c: number) => (c % GRID_W) - HALF_W + 0.5;
const cellWZ = (c: number) => ((c / GRID_W) | 0) - HALF_H + 0.5;

// ---------------------------------------------------------------- 视线

/** 两点之间有没有遮挡（墙、高过视线的障碍），按眼睛高度连线 */
function canSee(g: Game, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  return !obstruction(g, ax, ay, az, bx - ax, by - ay, bz - az);
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ---------------------------------------------------------------- 每帧

export function updateTdm(g: Game, dt: number): void {
  const t = g.tdm;
  if (!t.on || t.over) return;
  for (const f of t.feed) f.t += dt;
  for (const d of t.drops) d.t += dt;
  updateNades(g, dt);
  while (t.feed.length && (t.feed[0] as { t: number }).t > 6) t.feed.shift();
  t.phaseT -= dt;
  spectate(g, dt);

  if (t.phase === 'freeze') {
    for (const s of t.soldiers) {
      s.sinceShot += dt;
      s.sinceHurt += dt;
    }
    if (t.phaseT <= 0) {
      t.phase = 'live';
      t.phaseT = TDM.roundTime;
      t.liveT = 0;
      g.events.emit('tdmRound', { stage: 'live', round: t.round, winner: -1, reason: '', income: 0 });
    }
    return;
  }

  if (t.phase === 'end') {
    // 打完了：活着的人放下枪站着，等下一局
    for (const s of t.soldiers) {
      s.sinceShot += dt;
      s.sinceHurt += dt;
      if (!s.alive) continue;
      const k = Math.min(1, dt * 8);
      s.vx -= s.vx * k;
      s.vz -= s.vz * k;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.aimPitch *= 0.9;
      s.crouch = false;
    }
    if (t.phaseT <= 0) {
      const decided = t.score[0] >= TDM.winRounds || t.score[1] >= TDM.winRounds || t.round >= TDM.maxRounds;
      if (decided) {
        t.over = true;
        t.winner = t.score[0] === t.score[1] ? -1 : t.score[0] > t.score[1] ? 0 : 1;
        g.events.emit('tdmOver', { winner: t.winner, score: [...t.score] as [number, number] });
        return;
      }
      if (t.round === TDM.half) halftime(g);
      t.round++;
      beginRound(g);
    }
    return;
  }

  // ---- 开打 ----
  t.liveT += dt;
  const all = targets(g);
  for (const s of t.soldiers) {
    s.sinceShot += dt;
    s.sinceHurt += dt;
    if (!s.alive) continue;
    think(g, s, all, dt);
    move(g, s, dt);
    shoot(g, s, all, dt);
  }

  const [a, b] = aliveCount(g);
  if (a === 0 || b === 0) endRound(g, a === b ? -1 : a > 0 ? 0 : 1, '全歼对手');
  else if (t.phaseT <= 0) {
    // 时间到：人多的赢；一样多就比剩下的血
    let hp0 = g.player.alive ? g.player.hp : 0;
    let hp1 = 0;
    for (const s of t.soldiers) {
      if (!s.alive) continue;
      if (s.team === 0) hp0 += s.hp;
      else hp1 += s.hp;
    }
    const w = a !== b ? (a > b ? 0 : 1) : hp0 === hp1 ? -1 : hp0 > hp1 ? 0 : 1;
    endRound(g, w, w === -1 ? '时间到 · 平局' : '时间到 · 剩下的人多');
  }
}

/** 玩家死了以后：先看两秒自己倒下的地方，然后跟着一个活着的队友；左键换下一个 */
function spectate(g: Game, dt: number): void {
  const t = g.tdm;
  const click = g.input.fire && !t.fireHeld;
  t.fireHeld = g.input.fire;
  if (g.player.alive) {
    t.spectate = null;
    t.deadT = 0;
    return;
  }
  t.deadT += dt;
  if (t.deadT < 2.2) return;
  const mates = t.soldiers.filter((s) => s.team === 0 && s.alive);
  if (!mates.length) {
    t.spectate = null;
    return;
  }
  const i = mates.findIndex((s) => s.id === t.spectate);
  if (i < 0) {
    // 第一次 / 正在看的人死了：换离得最近的
    const from = t.soldiers.find((s) => s.id === t.spectate) ?? g.player;
    let best = mates[0] as Soldier;
    for (const s of mates) if (Math.hypot(s.x - from.x, s.z - from.z) < Math.hypot(best.x - from.x, best.z - from.z)) best = s;
    t.spectate = best.id;
  } else if (click) t.spectate = (mates[(i + 1) % mates.length] as Soldier).id;
}

/** 选目标、决定意图 */
function think(g: Game, s: Soldier, all: Tgt[], dt: number): void {
  const br = s.brain;
  br.thinkT -= dt;
  br.modeT -= dt;
  br.coverT -= dt;
  br.fleeT -= dt;
  const eyeY = (s.crouch ? 1.1 : TDM.headY) + s.y;
  const st = arenaStats(s.gun);
  // ---- 找看得见的敌人（每 0.1 秒看一次，像人眼扫视，不是每帧全知）----
  if (br.thinkT <= 0) {
    br.thinkT = 0.1;
    let best: Tgt | null = null;
    let bestScore = 1e9;
    // 拿近战枪的人不和远处的长枪对枪（打不着还送命），除非正在挨打——那就先找掩体
    const close = s.weapon === 'smg' || s.weapon === 'shotgun';
    const reach = close && s.sinceHurt > 1.5 ? st.range * 1.1 : TDM.sight;
    for (const e of all) {
      if (e.team === s.team || !e.alive) continue;
      const d = Math.hypot(e.x - s.x, e.z - s.z);
      if (d > reach) continue;
      const ang = Math.abs(angDiff(Math.atan2(e.x - s.x, e.z - s.z), s.aimYaw));
      // 视野外的只有很近（4 米内，听得见脚步）才察觉
      if (ang > TDM.fov && d > 4) continue;
      if (!canSee(g, s.x, eyeY, s.z, e.x, e.eye - 0.2, e.z)) continue;
      const score = d + ang * 8 - (e.id === br.target ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      if (br.target !== best.id) {
        // 新目标：反应时间 + 一个大的初始准星误差（越远、技术越差越大；从背后转过来更慢）
        const ang = Math.abs(angDiff(Math.atan2(best.x - s.x, best.z - s.z), s.aimYaw));
        br.reactT = ((0.18 + 0.32 * g.rng.next()) / br.skill + ang * 0.25) * LV(g).react;
        br.headAim = g.rng.next() < LV(g).head * Math.min(1.3, br.skill);
        const d = Math.hypot(best.x - s.x, best.z - s.z);
        br.aimErrYaw = ((g.rng.next() - 0.5) * (0.12 + d * 0.006)) / br.skill;
        br.aimErrPitch = ((g.rng.next() - 0.5) * 0.06) / br.skill;
        s.burst = 0;
      }
      br.target = best.id;
      br.lastSeenX = best.x;
      br.lastSeenZ = best.z;
      br.lastSeenT = g.run.time;
    } else if (br.target !== null && g.run.time - br.lastSeenT > 0.6) {
      // 目标躲到掩体后面 0.6 秒以上才算丢了：扫一眼看不见就立刻丢的话，
      // 对方左右晃过一根柱子就要重新反应、重新瞄，近战枪几乎开不了火
      br.target = null;
      // 人躲起来了：身上有雷的话，可能往他躲的地方扔一颗
      br.wantNade = s.nades > 0 && g.rng.next() < LV(g).nade;
    }
  }

  // 手雷滚到脚边了：跑开（不是每个人都反应得过来）
  if (br.fleeT <= 0) {
    for (const n of g.tdm.grenades) {
      const nd = Math.hypot(n.x - s.x, n.z - s.z);
      if (n.fuse > 1.3 || nd > 5.5 || (n.team === s.team && n.owner !== s.id)) continue;
      br.fleeT = 1.6;
      if (g.rng.next() > LV(g).cover) break;
      const k = 7 / (nd || 1);
      br.mode = 'cover';
      br.modeT = 1.2;
      setGoal(g, s, s.x + (s.x - n.x) * k, s.z + (s.z - n.z) * k);
      break;
    }
  }

  const tgt = br.target === null ? null : (all.find((e) => e.id === br.target) ?? null);
  const low = s.hp < s.maxHp * 0.35;
  const reloading = s.reloadT > 0;

  // ---- 意图 ----
  if (tgt) {
    // 蹲点的人看见人了：该追该躲照常动
    if (br.holdT > 0) br.holdT = 0;
    const d = Math.hypot(tgt.x - s.x, tgt.z - s.z);
    // 残血 / 换弹 / 掏枪 / 正在挨打：找掩体。不是每次都躲（看水平）；决定了不躲就硬打一阵，过一会儿再想
    const pinned = s.sinceHurt < 0.5 && s.hp < s.maxHp * 0.8;
    let took = false;
    if ((low || reloading || s.drawT > 0 || pinned) && !s.knife && br.mode !== 'cover' && br.coverT <= 0) {
      br.coverT = 1.2;
      const c = g.rng.next() < LV(g).cover ? findCover(g, s, tgt) : null;
      if (c) {
        br.mode = 'cover';
        br.coverX = c.x;
        br.coverZ = c.z;
        br.modeT = reloading ? s.reloadT + 0.5 : 1.4 + g.rng.next() * 1.2;
        setGoal(g, s, c.x, c.z);
        took = true;
      }
    }
    if (took) {
      // 往掩体跑
    } else if (s.knife) {
      // 子弹全打光了：拿着刀贴上去
      br.mode = 'fight';
      if (br.pathT <= 0 || br.path.length === 0) setGoal(g, s, tgt.x, tgt.z);
    } else if (br.mode !== 'cover' || br.modeT <= 0) {
      br.mode = 'fight';
      // 保持自己枪的舒服距离：近战枪不会在远处站着对枪，而是先躲进掩体、绕过去再打；长枪往后退一点
      const want = st.range * 0.55;
      const close = s.weapon === 'smg' || s.weapon === 'shotgun';
      if (close && d > st.range * 0.75 && br.modeT <= 0) {
        // 打不到：正在挨打就先躲到掩体后面，否则躲开对方视线往前摸（掩体之间跳），不正面硬冲
        const c = s.sinceHurt < 1.5 ? (findCover(g, s, tgt) ?? flank(g, s, tgt)) : flank(g, s, tgt);
        br.mode = 'cover';
        br.modeT = 1.6;
        if (c) setGoal(g, s, c.x, c.z);
        else setGoal(g, s, tgt.x, tgt.z);
      } else if (d > want + 6 || !canSee(g, s.x, TDM.headY, s.z, tgt.x, tgt.eye, tgt.z)) setGoal(g, s, tgt.x, tgt.z);
      else if (d < want * 0.4 && !close) setGoal(g, s, s.x - (tgt.x - s.x) * 0.3, s.z - (tgt.z - s.z) * 0.3);
      else br.path = [];
    }
    // 交火时横移，每 0.5–1.2 秒换一次方向；技术好的更爱动
    br.strafeT -= dt;
    if (br.strafeT <= 0) {
      br.strafeT = 0.5 + g.rng.next() * 0.7;
      br.strafe = g.rng.next() < 0.5 ? -1 : 1;
      if (g.rng.next() < 0.25) br.strafe = 0;
      // 用长枪的偶尔蹲下打；狙击枪更爱蹲（蹲着才稳）
      s.crouch = (s.weapon === 'sniper' && g.rng.next() < 0.6) || ((s.weapon === 'lmg' || s.weapon === 'rifle') && g.rng.next() < 0.35);
      if (s.weapon === 'sniper' && s.crouch) br.strafe = 0;
      // 灵活的人挨打的时候会跳着躲（跳起来枪也打不准，所以不是一直跳）
      if (br.agile && s.sinceHurt < 1.2 && d < 18 && !s.crouch && g.rng.next() < 0.3) br.jump = true;
    }
    // 躲到掩体后面了：蹲下，等换完弹 / 缓过来再出去
    if (br.mode === 'cover' && br.path.length === 0) s.crouch = true;
  } else {
    s.crouch = false;
    const looting = seekGun(g, s, dt);
    if (looting) br.mode = 'advance';
    else if (g.run.time - br.lastSeenT < 8 && br.mode !== 'search') {
      // 刚丢了目标：去最后看见的地方搜
      br.mode = 'search';
      br.modeT = 6;
      setGoal(g, s, br.lastSeenX, br.lastSeenZ);
    } else if (br.mode === 'search' && (br.modeT <= 0 || br.path.length === 0)) {
      br.mode = 'advance';
      br.path = [];
    }
    if (!looting && (br.mode === 'advance' || br.mode === 'cover' || br.mode === 'fight')) {
      br.mode = 'advance';
      if (br.path.length === 0 || br.pathT <= 0) advance(g, s, all);
    }
  }
  br.pathT -= dt;
}

/** 地上这把值不值得捡：有子弹的长枪；手里拿的是冲锋枪 / 霰弹枪的话，得是贵不少的步枪 / 狙击枪 / 机枪才换 */
function lootWorth(s: Soldier, x: DroppedGun, cheap: boolean): boolean {
  const cls = (GUN_BY_ID[x.gun] as GunDef).cls;
  if (cls === 'pistol' || x.mag + x.reserve <= 0 || x.t < 0.6) return false;
  return !cheap || (cls !== 'smg' && cls !== 'shotgun' && priceOf(x.gun) >= priceOf(s.gun) + 800);
}

/**
 * 看见附近地上有更好的枪就过去捡（没在交火的时候），像真人打经济局那样：
 * 手里只有手枪的、长枪打光了的，见到有子弹的长枪就捡；拿着冲锋枪 / 霰弹枪的，见到步枪 / 狙击枪 / 机枪就换。
 * 返回 true = 正往那边走
 */
function seekGun(g: Game, s: Soldier, dt: number): boolean {
  const br = s.brain;
  const t = g.tdm;
  const dry = s.mag + s.reserve <= 0;
  const cheap = !dry && (s.weapon === 'smg' || s.weapon === 'shotgun');
  const want = s.weapon === 'pistol' ? !s.alt || s.alt.mag + s.alt.reserve <= 0 : dry || cheap;
  if (!want) {
    br.loot = null;
    return false;
  }
  let d = br.loot === null ? undefined : t.drops.find((x) => x.id === br.loot);
  br.lootT -= dt;
  if (!d && br.lootT <= 0) {
    br.lootT = 0.8;
    let bestD = 13;
    for (const x of t.drops) {
      if (!lootWorth(s, x, cheap)) continue;
      const dist = Math.hypot(x.x - s.x, x.z - s.z);
      // 队友已经奔着它去了就算了
      if (dist >= bestD || t.soldiers.some((o) => o !== s && o.alive && o.brain.loot === x.id)) continue;
      bestD = dist;
      d = x;
    }
    if (d) {
      br.loot = d.id;
      setGoal(g, s, d.x, d.z);
    }
  }
  if (!d) {
    br.loot = null;
    return false;
  }
  if (Math.hypot(d.x - s.x, d.z - s.z) < 1.2) {
    soldierPickup(g, s, d);
    br.loot = null;
    br.path = [];
    return false;
  }
  if (br.path.length === 0 || br.pathT <= 0) setGoal(g, s, d.x, d.z);
  // 走不过去的就别惦记了
  if (br.path.length === 0) {
    br.loot = null;
    br.lootT = 5;
    return false;
  }
  return true;
}

/**
 * 推进：沿自己那条路一个点一个点往对面走，走到头就换一条路往回扫。
 * 打了一阵还没打完、或者对面只剩一两个：直接往最近的敌人大概的位置摸（队友报点），免得满图找不着人
 */
function advance(g: Game, s: Soldier, all: Tgt[]): void {
  const br = s.brain;
  const t = g.tdm;
  let foes = 0;
  let near: Tgt | null = null;
  let nearD = 1e9;
  for (const e of all) {
    if (e.team === s.team || !e.alive) continue;
    foes++;
    const d = Math.hypot(e.x - s.x, e.z - s.z);
    if (d < nearD) {
      nearD = d;
      near = e;
    }
  }
  if (near && (t.liveT > TDM.huntAfter || foes <= 2)) {
    setGoal(g, s, near.x + (g.rng.next() - 0.5) * 8, near.z + (g.rng.next() - 0.5) * 8);
    br.pathT = 2.5 + g.rng.next() * 2;
    return;
  }
  let route = ROUTES[br.lane] as ReadonlyArray<readonly [number, number]>;
  const at = route[br.wp] as readonly [number, number];
  if (Math.hypot(s.x - (at[0] - HALF_W + 0.5), s.z - (at[1] - HALF_H + 0.5)) < 4.5) {
    // 到了自己半场的路口（第二个点）：打算蹲点的人在这停下，脸朝着对面来的方向
    if (br.camp > 0 && br.wp === (br.dir === 1 ? 1 : route.length - 2)) {
      br.holdT = br.camp;
      br.camp = 0;
      br.path = [];
      br.pathT = br.holdT;
      const ahead = route[br.wp + br.dir] as readonly [number, number];
      s.yaw = Math.atan2(ahead[0] - HALF_W + 0.5 - s.x, ahead[1] - HALF_H + 0.5 - s.z);
      return;
    }
    const next = br.wp + br.dir;
    if (next < 0 || next >= route.length) {
      br.lane = g.rng.int(0, ROUTES.length - 1);
      br.dir = (br.dir === 1 ? -1 : 1) as 1 | -1;
      route = ROUTES[br.lane] as ReadonlyArray<readonly [number, number]>;
      br.wp = br.dir === 1 ? 0 : route.length - 1;
    } else br.wp = next;
  }
  const to = route[br.wp] as readonly [number, number];
  setGoal(g, s, to[0] - HALF_W + 0.5 + (g.rng.next() - 0.5) * 3, to[1] - HALF_H + 0.5 + (g.rng.next() - 0.5) * 3);
  br.pathT = 4 + g.rng.next() * 3;
}

function setGoal(g: Game, s: Soldier, x: number, z: number): void {
  const br = s.brain;
  // 目标点在墙里：找附近能站的格子
  let cx = clamp(g.grid.cellX(x), 4, GRID_W - 5);
  let cy = clamp(g.grid.cellY(z), 4, GRID_W - 5);
  for (let r = 0; r < 8 && g.grid.isBlocked(cx, cy); r++) {
    cx = clamp(cx + g.rng.int(-1, 1), 4, GRID_W - 5);
    cy = clamp(cy + g.rng.int(-1, 1), 4, GRID_W - 5);
  }
  br.goalX = g.grid.centerX(cx);
  br.goalZ = g.grid.centerZ(cy);
  br.path = findPath(g, s.x, s.z, br.goalX, br.goalZ, br.agile);
  br.pathT = 1.5;
}

/** 侧翼前进：往目标方向前进 4–9 米、并且对方看不见的点（绕着掩体摸过去） */
function flank(g: Game, s: Soldier, tgt: Tgt): { x: number; z: number } | null {
  const base = Math.atan2(tgt.x - s.x, tgt.z - s.z);
  let best: { x: number; z: number } | null = null;
  let bestD = 1e9;
  for (let i = 0; i < 28; i++) {
    const a = base + (g.rng.next() - 0.5) * 2.2;
    const r = 4 + g.rng.next() * 5;
    const x = s.x + Math.sin(a) * r;
    const z = s.z + Math.cos(a) * r;
    if (g.grid.isBlocked(g.grid.cellX(x), g.grid.cellY(z))) continue;
    if (canSee(g, tgt.x, tgt.eye, tgt.z, x, 1.3, z)) continue;
    const d = Math.hypot(x - tgt.x, z - tgt.z);
    if (d < bestD) {
      bestD = d;
      best = { x, z };
    }
  }
  return best;
}

/** 掩体：附近九米内、蹲下以后对方看不见的地方（障碍物背后）。能直着跑过去的优先 */
function findCover(g: Game, s: Soldier, tgt: Tgt): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = 1e9;
  for (let i = 0; i < 36; i++) {
    const a = g.rng.next() * Math.PI * 2;
    const r = 1.5 + g.rng.next() * 7;
    const x = s.x + Math.sin(a) * r;
    const z = s.z + Math.cos(a) * r;
    if (g.grid.isBlocked(g.grid.cellX(x), g.grid.cellY(z))) continue;
    if (canSee(g, tgt.x, tgt.eye, tgt.z, x, 1.0, z)) continue;
    // 绕一大圈才到的掩体，跑到一半就被打死了；离对方近的也不要
    const d = r + (g.grid.segmentClear(s.x, s.z, x, z, true) ? 0 : 4) - Math.hypot(x - tgt.x, z - tgt.z) * 0.1;
    if (d < bestD) {
      bestD = d;
      best = { x, z };
    }
  }
  return best;
}

function move(g: Game, s: Soldier, dt: number): void {
  const br = s.brain;
  let mx = 0;
  let mz = 0;
  br.holdT -= dt;
  // 沿路径走：到了下一个格子就弹出
  while (br.holdT <= 0 && br.path.length) {
    const c = br.path[0] as number;
    const wx = cellWX(c);
    const wz = cellWZ(c);
    if (Math.hypot(wx - s.x, wz - s.z) < 0.45) {
      br.path.shift();
      continue;
    }
    mx = wx - s.x;
    mz = wz - s.z;
    break;
  }
  const ml = Math.hypot(mx, mz);
  if (ml > 0) {
    mx /= ml;
    mz /= ml;
  }
  // 交火：在原来的移动上叠加横移
  if (br.mode === 'fight' && br.target !== null && br.strafe !== 0) {
    const sx = Math.cos(s.aimYaw) * br.strafe;
    const sz = -Math.sin(s.aimYaw) * br.strafe;
    mx = mx * 0.5 + sx * 0.8;
    mz = mz * 0.5 + sz * 0.8;
  }
  // 队友之间保持距离
  for (const o of g.tdm.soldiers) {
    if (o === s || !o.alive || o.team !== s.team) continue;
    const dx = s.x - o.x;
    const dz = s.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.6 && d > 1e-3) {
      mx += (dx / d) * (1.6 - d);
      mz += (dz / d) * (1.6 - d);
    }
  }
  // 也别顶着玩家走
  if (s.team === 0 && g.player.alive) {
    const dx = s.x - g.player.x;
    const dz = s.z - g.player.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.3 && d > 1e-3) {
      mx += (dx / d) * (1.3 - d) * 1.5;
      mz += (dz / d) * (1.3 - d) * 1.5;
    }
  }
  const l = Math.hypot(mx, mz);
  // 重的枪走得慢；蹲着、交火时慢
  const wk = s.weapon === 'lmg' ? 0.82 : s.weapon === 'sniper' ? 0.88 : s.weapon === 'rifle' ? 1 : 1.1;
  const sp = TDM.speed * wk * (s.knife ? KNIFE.speed : 1) * (s.crouch ? 0.45 : br.mode === 'fight' && !s.knife ? 0.7 : 1);
  const tvx = l > 0 ? (mx / Math.max(1, l)) * sp : 0;
  const tvz = l > 0 ? (mz / Math.max(1, l)) * sp : 0;
  const k = Math.min(1, dt * 10);
  s.vx += (tvx - s.vx) * k;
  s.vz += (tvz - s.vz) * k;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  // 跳：路上的下一格是能踩上去的矮掩体（翻过去）、挨打的时候跳着躲、顶着东西走不动了
  const next = br.holdT <= 0 && br.path.length ? (br.path[0] as number) : -1;
  const hop = next >= 0 && topAt(g, next % GRID_W, (next / GRID_W) | 0) > s.y + JUMP.step && Math.hypot(cellWX(next) - s.x, cellWZ(next) - s.z) < 1.3;
  br.stuckT = br.agile && l > 0.2 && Math.hypot(s.vx, s.vz) < 0.35 ? br.stuckT + dt : 0;
  if ((hop || br.jump || br.stuckT > 0.7) && grounded(g, s.x, s.z, s.y, s.vy)) {
    s.vy = JUMP.v;
    br.stuckT = 0;
    g.events.emit('tdmJump', { id: s.id, land: false, x: s.x, z: s.z });
  }
  br.jump = false;
  resolveCircleVsGrid(g.grid, s, TDM.radius, false, false, passAbove(g, s.y));
  const v = stepVertical(g, s.x, s.z, s.y, s.vy, dt);
  s.y = v.y;
  s.vy = v.vy;
  if (v.landed) g.events.emit('tdmJump', { id: s.id, land: true, x: s.x, z: s.z });
  s.walkPhase += Math.hypot(s.vx, s.vz) * dt * 2.4;
  // 身体朝向：交火时朝着目标，平时朝走路方向
  const want = br.target !== null ? s.aimYaw : Math.hypot(s.vx, s.vz) > 0.3 ? Math.atan2(s.vx, s.vz) : s.yaw;
  s.yaw += angDiff(want, s.yaw) * Math.min(1, dt * 8);
}

function shoot(g: Game, s: Soldier, all: Tgt[], dt: number): void {
  const br = s.brain;
  const st = arenaStats(s.gun);
  s.fireT -= dt;
  if (s.drawT > 0) s.drawT -= dt;
  const tgt = br.target === null ? null : (all.find((e) => e.id === br.target) ?? null);
  const d = tgt ? Math.hypot(tgt.x - s.x, tgt.z - s.z) : 1e9;

  // 挥刀：挥到一半的那一下算打中
  if (s.meleeT >= 0) {
    const k = s.meleeKind === 2 ? KNIFE.stab : KNIFE.slash;
    const before = s.meleeT;
    s.meleeT += dt;
    if (before < k.hitAt && s.meleeT >= k.hitAt) knifeHit(g, s.id, s.team, s.x, s.z, s.y, s.aimYaw, s.meleeKind === 2);
    if (s.meleeT >= k.dur) s.meleeT = -1;
  }
  // 扔手雷：抬手的时候转向要扔的方向，时间到了出手
  if (s.throwT > 0) {
    s.throwT -= dt;
    s.aimYaw += clamp(angDiff(br.nadeYaw, s.aimYaw), -8 * dt, 8 * dt);
    if (s.throwT <= 0) {
      s.throwT = 0;
      if (s.nades > 0) {
        s.nades--;
        throwNade(g, s.id, s.team, s.x + Math.sin(br.nadeYaw) * 0.4, s.y + 1.5, s.z + Math.cos(br.nadeYaw) * 0.4, br.nadeYaw, br.nadePitch);
        s.drawT = Math.max(s.drawT, 0.5);
      }
    }
    return;
  }
  // 人贴到脸上了，手里的枪又打不了（换弹 / 掏枪 / 没子弹）：给他一刀
  if (tgt && s.meleeT < 0 && d - TDM.radius < KNIFE.slash.range - 0.3 && Math.abs(tgt.y - s.y) < 1 && (s.knife || s.reloadT > 0 || s.drawT > 0) && g.run.time - br.lastSeenT < 0.3) {
    if (Math.abs(angDiff(Math.atan2(tgt.x - s.x, tgt.z - s.z), s.aimYaw)) < 0.6) {
      s.meleeT = 0;
      s.meleeKind = s.knife && g.rng.next() < 0.35 ? 2 : s.meleeKind === 0 ? 1 : 0;
      g.events.emit('tdmSwing', { id: s.id, kind: s.meleeKind, x: s.x, z: s.z });
    }
  }
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= 0) {
      const n = Math.min(st.mag - s.mag, s.reserve);
      s.mag += n;
      s.reserve -= n;
    }
    // 换弹的时候眼睛也盯着人
    if (tgt) s.aimYaw += clamp(angDiff(Math.atan2(tgt.x - s.x, tgt.z - s.z), s.aimYaw), -5 * dt, 5 * dt);
    return;
  }
  if (!tgt) {
    // 没目标：刚丢了人就盯着他最后出现的地方（预瞄），不然视线跟着走路方向转；残弹换掉
    const fresh = g.run.time - br.lastSeenT;
    const look = fresh < 6 ? Math.atan2(br.lastSeenX - s.x, br.lastSeenZ - s.z) : s.yaw;
    s.aimYaw += angDiff(look, s.aimYaw) * Math.min(1, dt * 4);
    s.aimPitch *= 0.9;
    if (br.wantNade && fresh > 0.5 && fresh < 4 && s.meleeT < 0) tryNade(g, s);
    if (s.mag < st.mag * 0.5 && s.reserve > 0 && !s.knife) s.reloadT = st.reload;
    return;
  }
  // 瞄准：真实方向 + 误差，误差随时间收敛（技术越好收得越快）
  const dx = tgt.x - s.x;
  const dz = tgt.z - s.z;
  const eyeY = (s.crouch ? 1.1 : TDM.headY) + s.y;
  // 瞄胸口；对这个目标打算瞄头的就瞄头
  const aimY = tgt.eye - (br.headAim ? 0.05 : 0.45);
  const trueYaw = Math.atan2(dx, dz);
  const truePitch = Math.atan2(aimY - eyeY, d);
  // 远处收敛得慢：30 米外要多瞄一会儿才稳
  const conv = Math.exp((-dt * 3.2 * br.skill) / (1 + d / 25));
  br.aimErrYaw *= conv;
  br.aimErrPitch *= conv;
  // 转枪口有速度上限（人的手腕转不了那么快）
  const turn = 7 * br.skill * dt;
  s.aimYaw += clamp(angDiff(trueYaw + br.aimErrYaw, s.aimYaw), -turn, turn);
  // 压枪：连射时后坐力把枪口往上顶，前几发顶得多，之后压住
  const recoil = WEAPONS[s.weapon].recoil.v * (GUN_BY_ID[s.gun]?.recoil ?? 1);
  const kick = recoil * (Math.PI / 180) * Math.min(4, s.burst) * 0.35 * (1.3 - Math.min(1.2, br.skill) * 0.5);
  s.aimPitch += (truePitch + br.aimErrPitch + kick - s.aimPitch) * Math.min(1, dt * 12);

  br.reactT -= dt;
  if (s.knife || br.reactT > 0 || s.fireT > 0 || s.drawT > 0 || s.meleeT >= 0) return;
  // 枪口还没对准就不开（人会等准星到了再打），远处要更准
  const off = Math.abs(angDiff(trueYaw, s.aimYaw));
  if (off > 0.05 + 2.5 / Math.max(4, d)) return;
  if (d > st.range * (FIRE_AT[s.weapon] ?? 1.05)) return;
  // 记着目标但这一刻看不见（在掩体后面）：瞄着那个方向等它出来，不对着墙放空枪
  if (g.run.time - br.lastSeenT > 0.15) return;
  if (s.mag <= 0) {
    emptied(g, s, d < 9);
    return;
  }
  // 长枪点射：打几发停一下；近战枪按住扫
  const tap = s.weapon === 'rifle' || s.weapon === 'lmg' ? 5 : s.weapon === 'smg' ? 10 : 1;
  if (s.burst >= tap && st.rate > 3.5 && g.rng.next() < 0.5) {
    s.burst = 0;
    s.fireT = 0.25 + g.rng.next() * 0.3;
    return;
  }
  fireSoldier(g, s, d);
  // 半自动 / 栓动：人扣扳机没那么齐，每发之间多等一点
  s.fireT = (1 / st.rate) * (st.rate < 3.5 ? 1.1 + g.rng.next() * 0.35 : 1);
  s.burst++;
  s.mag--;
  if (s.mag <= 0) emptied(g, s, d < 9);
}

/** 往目标最后出现的地方扔一颗雷：太近、够不着、弹道上有东西挡着（会弹回来）都不扔 */
function tryNade(g: Game, s: Soldier): void {
  const br = s.brain;
  br.wantNade = false;
  const dx = br.lastSeenX - s.x;
  const dz = br.lastSeenZ - s.z;
  const d = Math.hypot(dx, dz);
  if (d < 8 || d > 26) return;
  const pitch = lobPitch(d, 1.4 + s.y);
  if (pitch === null) return;
  const yaw = Math.atan2(dx, dz);
  if (!arcClear(g, s.x, s.y + 1.5, s.z, yaw, pitch, d)) return;
  br.nadeYaw = yaw;
  br.nadePitch = pitch;
  s.throwT = NADE.windup;
}

/** 人机开一枪：和玩家用同一套子弹（有弹道、会被墙挡），子弹记下是谁开的 */
function fireSoldier(g: Game, s: Soldier, far: number): void {
  const kind = s.weapon;
  const def = WEAPONS[kind];
  const st = arenaStats(s.gun);
  s.sinceShot = 0;
  const eyeY = (s.crouch ? 1.1 : TDM.headY) + s.y;
  const ox = s.x + Math.sin(s.aimYaw) * 0.5;
  const oz = s.z + Math.cos(s.aimYaw) * 0.5;
  g.events.emit('soldierShot', { id: s.id, kind, gun: s.gun, x: ox, y: eyeY - 0.1, z: oz, yaw: s.aimYaw });
  // 散布：站稳了算举着枪瞄（散布按举镜的算一大半），走着打就是腰射；蹲下更稳
  const moving = Math.min(1, Math.hypot(s.vx, s.vz) / TDM.speed);
  const steady = clamp(1 - moving * 1.6, 0, 1) * (s.crouch ? 0.95 : 0.8);
  const shake = (0.006 + far * 0.0005) / s.brain.skill;
  // 跳在半空中打不准
  const air = grounded(g, s.x, s.z, s.y, s.vy) ? 1 : 2.6;
  const spread = (st.spread * (Math.PI / 180) * (1 + (def.ads.spread - 1) * steady) * (0.8 + 0.5 * moving) + shake) * air;
  const lift = zeroPitch(kind);
  const damage = st.damage * LV(g).damage * vsHuman(s.gun, kind);
  for (let i = 0; i < st.pellets; i++) {
    const yaw = s.aimYaw + (g.rng.next() + g.rng.next() - 1) * spread;
    const pit = s.aimPitch + lift + (g.rng.next() + g.rng.next() - 1) * spread;
    const c = Math.cos(pit);
    g.bullets.push({
      id: g.nextBulletId++,
      kind,
      x: ox,
      y: eyeY - 0.1,
      z: oz,
      vx: Math.sin(yaw) * c * def.muzzle,
      vy: Math.sin(pit) * def.muzzle,
      vz: Math.cos(yaw) * c * def.muzzle,
      damage,
      pierceLeft: 0,
      traveled: 0,
      range: st.range,
      burn: 0,
      slowHit: 0,
      refund: 0,
      hit: [],
      owner: s.id,
      team: s.team,
    });
  }
  heard(g, s.team, s.x, s.z);
}

/** 枪声：附近的敌人能听见，去声音的方向搜 */
function heard(g: Game, team: 0 | 1, x: number, z: number): void {
  for (const o of g.tdm.soldiers) {
    if (o.team === team || !o.alive || o.brain.target !== null) continue;
    if (Math.hypot(o.x - x, o.z - z) > TDM.hear) continue;
    o.brain.lastSeenX = x + (g.rng.next() - 0.5) * 4;
    o.brain.lastSeenZ = z + (g.rng.next() - 0.5) * 4;
    o.brain.lastSeenT = g.run.time;
    o.brain.mode = 'advance';
  }
}

/** 玩家开枪时也会被听见 */
export function tdmPlayerShot(g: Game): void {
  if (!g.tdm.on || g.tdm.phase !== 'live') return;
  heard(g, 0, g.player.x, g.player.z);
}

/** 冻结时间：玩家不能动、不能开枪（可以转头、买东西） */
export const tdmFrozen = (g: Game): boolean => g.tdm.on && g.tdm.phase === 'freeze';

// ---------------------------------------------------------------- 子弹命中士兵 / 玩家

export interface TdmHit {
  t: number;
  head: boolean;
  /** 士兵 id，或 -1 = 玩家 */
  id: number;
}

/** 子弹这一小段打中了哪个士兵（或玩家）：返回最近的一个 */
export function tdmSegHit(g: Game, team: 0 | 1 | -1, owner: number, ax: number, ay: number, az: number, dx: number, dy: number, dz: number, stopT: number): TdmHit | null {
  let best: TdmHit | null = null;
  const test = (id: number, x: number, z: number, h: number, y0: number) => {
    const hy = y0 + h - 0.13;
    const th = segSphere(ax, ay, az, dx, dy, dz, x, hy, z, TDM.headR);
    const tb = segCylinder(ax, ay - y0, az, dx, dy, dz, x, z, TDM.radius, h - 0.2);
    let t = -1;
    let head = false;
    if (th >= 0 && (tb < 0 || th <= tb + 0.02)) {
      t = th;
      head = true;
    } else if (tb >= 0) t = tb;
    if (t >= 0 && t <= stopT && (!best || t < best.t)) best = { t, head, id };
  };
  for (const s of g.tdm.soldiers) {
    if (!s.alive || s.id === owner || s.team === team) continue;
    test(s.id, s.x, s.z, s.crouch ? 1.25 : TDM.height, s.y);
  }
  const p = g.player;
  if (p.alive && owner !== PLAYER && team !== 0) test(PLAYER, p.x, p.z, p.eye + 0.13, p.air);
  return best;
}

/** 结算一颗子弹的命中。(dx, dz) = 子弹飞的方向（倒地往哪边倒） */
export function tdmDamage(g: Game, hit: TdmHit, kind: WeaponKind, damage: number, traveled: number, range: number, owner: number, dx = 0, dz = 0): void {
  const t = g.tdm;
  const shooter = owner === PLAYER ? null : (t.soldiers.find((s) => s.id === owner) ?? null);
  const gunId = shooter ? shooter.gun : g.config.guns[kind];
  // 玩家的子弹伤害还没乘过对人的倍率（人机的子弹出膛时已经乘了）
  let dmg = damage * falloffAt(kind, traveled, range) * (owner === PLAYER ? vsHuman(gunId, kind) : 1);
  if (hit.head) dmg *= WEAPONS[kind].headMult;
  tdmHurt(g, hit.id, dmg, hit.head, { owner, name: GUN_BY_ID[gunId]?.name ?? WEAPONS[kind].name, reward: KILL_REWARD[catOf(gunId)] }, dx, dz);
}

/** 谁、用什么打的（击杀信息里显示的名字、打死了给多少钱） */
export interface HurtSrc {
  owner: number;
  name: string;
  reward: number;
}

/**
 * 一个人（id = 士兵 id，-1 = 玩家）挨了一下（子弹 / 刀 / 手雷）：护甲、扣血、击杀、发钱、击杀信息、掉枪。
 * (dx, dz) = 这一下的方向（倒地往哪边倒）
 */
export function tdmHurt(g: Game, id: number, dmg: number, head: boolean, src: HurtSrc, dx = 0, dz = 0): void {
  const t = g.tdm;
  // 一局打完以后还在飞的子弹、还没炸的雷不算
  if (t.phase !== 'live') return;
  const shooter = src.owner === PLAYER ? null : (t.soldiers.find((s) => s.id === src.owner) ?? null);
  const killerName = shooter ? shooter.name : '你';
  const killerTeam: 0 | 1 = shooter ? shooter.team : 0;
  const credit = () => {
    // 自己把自己炸死不给钱
    if (src.owner === id) return;
    if (shooter) {
      shooter.kills++;
      shooter.money = Math.min(ECON.cap, shooter.money + src.reward);
    } else {
      t.playerKills++;
      t.money = Math.min(ECON.cap, t.money + src.reward);
    }
  };
  if (id === PLAYER) {
    const p = g.player;
    if (!p.alive) return;
    const r = throughArmor(dmg, head, t.armor, t.helmet);
    t.armor = r.armor;
    g.damagePlayer(r.hp);
    g.events.emit('tdmHurt', { fromId: src.owner });
    if (!p.alive) {
      t.playerDeaths++;
      t.deadT = 0;
      t.spectate = null;
      credit();
      t.feed.push({ killer: killerName, victim: '你', kt: killerTeam, vt: 0, gun: src.name, head, t: 0 });
      // 主武器掉在地上（队友可以捡走）
      const k = playerPrimary(g);
      if (k) dropGun(g, g.config.guns[k], p.x + dx * 0.4, p.z + dz * 0.4, p.yaw + 1.2, g.loadout[k].mag, t.reserve[k], p.air + 1.1);
    }
    return;
  }
  const s = t.soldiers.find((x) => x.id === id);
  if (!s || !s.alive) return;
  const r = throughArmor(dmg, head, s.armor, s.helmet);
  s.armor = r.armor;
  s.hp -= r.hp;
  s.sinceHurt = 0;
  // 挨打了就别蹲着了
  s.brain.holdT = Math.min(s.brain.holdT, 0);
  s.brain.camp = 0;
  // 被打了：转头找打自己的人（有反应时间）
  if (s.brain.target === null && src.owner !== id) {
    const from = shooter ?? g.player;
    s.brain.lastSeenX = from.x;
    s.brain.lastSeenZ = from.z;
    s.brain.lastSeenT = g.run.time;
  }
  g.events.emit('soldierHit', { id: s.id, amount: r.hp, head, byPlayer: src.owner === PLAYER, x: s.x, y: s.y + (head ? TDM.headY : 1.1), z: s.z });
  if (s.hp <= 0) {
    s.alive = false;
    s.deaths++;
    credit();
    t.feed.push({ killer: killerName, victim: s.name, kt: killerTeam, vt: s.team, gun: src.name, head, t: 0 });
    // 枪掉在地上：手里的（白给的手枪不算），还有身上那把长枪
    if (s.gun !== DEFAULT_PISTOL) dropGun(g, s.gun, s.x + dx * 0.4, s.z + dz * 0.4, s.yaw + 1.2, s.mag, s.reserve, s.y + 1.1);
    if (s.alt && (GUN_BY_ID[s.alt.gun] as GunDef).cls !== 'pistol') dropGun(g, s.alt.gun, s.x - dz * 0.5, s.z + dx * 0.5, s.yaw - 0.8, s.alt.mag, s.alt.reserve, s.y + 0.9);
    g.events.emit('soldierDied', { id: s.id, team: s.team, byPlayer: src.owner === PLAYER, head, dx, dz });
  }
}
