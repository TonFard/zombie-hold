import { clamp } from '../core/math';
import { STAR_FX } from '../data/stars';
import { EYE_HEIGHT } from '../data/ballistics';
import type { WeaponKind } from '../data/weapons';
import { resolveCircleVsGrid } from '../world/collision';
import type { Game } from '../sim';
import { fireWeapon, melee } from './combat';
import { DAZE_SLOW, throwGrenade } from './hazards';
import { tdmFrozen } from './tdm';
import { passAbove, playerPickup, playerVertical, tdmPlayerInput } from './tdm-gear';
import { KNIFE } from '../data/shop';

const BASE_SPEED = 3.4;
const SPRINT_MULT = 1.5;
/** 蹲下时的移动速度倍率、眼睛高度 */
const CROUCH_MULT = 0.55;
export const CROUCH_EYE = 1.08;
/** 滑铲：初速倍率、持续时间、冷却 */
const SLIDE_BOOST = 1.75;
const SLIDE_TIME = 0.7;
const SLIDE_CD = 0.9;
/** 冲刺结束后要过这么久才能开火（放下冲刺姿势、把枪抬起来） */
const SPRINT_OUT = 0.14;
/** 打空弹匣的完整换弹 vs 还有子弹的战术换弹（少一个拉机柄的动作） */
const TACTICAL_RELOAD = 0.85;
/** 近战：冷却、出手到命中的延迟 */
export const MELEE_TIME = 0.6;
const MELEE_HIT_AT = 0.12;

function startReload(g: Game): void {
  const p = g.player;
  const st = g.statsOf(p.weapon, p.tier);
  const tactical = g.loadout[p.weapon].mag > 0;
  // 重的枪换弹也慢一点（重量的"操控"系数）
  // 升星：手枪 ★2 换弹 −25%
  const sp = g.config.stars.pistol;
  const starK = p.weapon === 'pistol' && sp >= 2 ? STAR_FX.pistolReload : 1;
  p.reloadTotal = Math.max(0.01, st.reload * (tactical ? TACTICAL_RELOAD : 1) * g.weightNow().handling * starK);
  p.reloadTimer = p.reloadTotal;
  g.events.emit('reload', { kind: p.weapon, start: true });
}

export function switchWeapon(g: Game, kind: WeaponKind): void {
  const p = g.player;
  const slot = g.loadout[kind];
  // 正式局只能切到带在身上的枪（放在工坊里的要去工坊换）
  if (!slot.owned || kind === p.weapon || (g.config.extras && !slot.carried)) return;
  p.weapon = kind;
  p.tier = slot.tier;
  p.reloadTimer = 0; // 切枪打断换弹
  p.fireTimer = 0.25 * g.weightNow().handling; // 举枪时间：越重越慢
  p.ramp = 0;
  p.ads = 0; // 换枪要重新举镜
  g.events.emit('weaponSwitch', { kind });
}

/** 玩家移动、蹲伏 / 滑铲、瞄准、切枪、换弹、射击、近战 */
export function updatePlayer(g: Game, dt: number): void {
  const p = g.player;
  const inp = g.input;

  if (!p.alive) {
    p.vx = 0;
    p.vz = 0;
    p.ads = 0;
    inp.select = 0;
    inp.cycle = 0;
    inp.reload = false;
    inp.melee = false;
    inp.grenade = false;
    inp.pulse = false;
    inp.jump = false;
    inp.use = false;
    return;
  }

  // 对战的冻结时间：站在原地，可以转头、切枪、买东西
  if (tdmFrozen(g)) {
    inp.moveX = 0;
    inp.moveZ = 0;
    inp.fire = false;
    inp.melee = false;
    inp.sprint = false;
  }
  // 对战：1 主武器 / 2 手枪 / 3 刀，Q 换回上一把，V 抽刀挥一下，G 手雷，E 捡枪（都在 tdm-gear.ts）
  if (g.tdm.on) {
    if (inp.use) {
      inp.use = false;
      playerPickup(g);
    }
    tdmPlayerInput(g, dt);
  }

  // ---- G 手雷（M12）。Q 以前是发电机电击脉冲，去掉了（对战里的 Q 在 tdmPlayerInput 里已经读走） ----
  if (inp.grenade) {
    inp.grenade = false;
    if (g.config.extras && !g.buildMode) throwGrenade(g);
  }
  inp.pulse = false;

  // ---- 切枪 ----
  if (inp.select > 0) {
    // 数字键就是身上武器的顺序（1 手枪、2 主武器），和工坊里前面那个编号一致
    const k = g.carried()[inp.select - 1];
    if (k) switchWeapon(g, k);
    inp.select = 0;
  }
  if (inp.cycle !== 0) {
    const list = g.carried();
    const i = list.indexOf(p.weapon);
    const k = list[(i + inp.cycle + list.length) % list.length];
    if (k && list.length > 1) switchWeapon(g, k);
    inp.cycle = 0;
  }

  // ---- 移动 ----
  let mx = inp.moveX;
  let mz = inp.moveZ;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  const moving = ml > 0.1;
  const st = g.statsOf(p.weapon, p.tier);
  const wt = g.weightNow();

  // 冲刺中按蹲 = 滑铲；滑铲结束后保持蹲姿（松开蹲键就站起来）
  p.slideCd = Math.max(0, p.slideCd - dt);
  if (inp.crouch && !p.crouchHeld && p.sprinting && moving && p.slideCd <= 0 && p.slide <= 0) {
    p.slide = SLIDE_TIME;
    p.slideCd = SLIDE_CD;
    const sp = Math.hypot(p.vx, p.vz) || BASE_SPEED;
    p.slideDirX = p.vx / sp;
    p.slideDirZ = p.vz / sp;
    g.events.emit('slide', {});
  }
  p.crouchHeld = inp.crouch;
  const sliding = p.slide > 0;
  if (sliding) p.slide -= dt;

  // 右键瞄准（建造模式下右键是拆除，不瞄准）；瞄准、蹲着、近战时不能冲刺
  const adsHeld = inp.ads && !g.buildMode;
  const wantSprint = inp.sprint && moving && !inp.crouch && !sliding && p.stamina > 0 && p.staminaLock <= 0 && !adsHeld && p.meleeTimer <= 0;
  if (p.sprinting && !wantSprint) p.sprintOut = SPRINT_OUT;
  p.sprinting = wantSprint;
  p.sprintOut = Math.max(0, p.sprintOut - dt);
  const wantAds = adsHeld && !wantSprint && !sliding && p.reloadTimer <= 0 && p.meleeTimer <= 0;
  // 重的枪举镜慢。步枪 ★2：举镜时间 −30%
  const adsK = p.weapon === 'rifle' && g.config.stars.rifle >= 2 ? STAR_FX.rifleAds : 1;
  p.ads = clamp(p.ads + ((wantAds ? 1 : -1) * dt) / Math.max(0.03, st.adsTime * wt.handling * adsK), 0, 1);
  const crouchTarget = inp.crouch || sliding ? 1 : 0;
  p.crouch = clamp(p.crouch + (crouchTarget - p.crouch) * Math.min(1, dt * 12), 0, 1);
  p.eye = EYE_HEIGHT + (CROUCH_EYE - EYE_HEIGHT) * p.crouch;

  if (wantSprint) {
    p.stamina = Math.max(0, p.stamina - 25 * g.mods.staminaUse * wt.stamina * dt);
    p.staminaDelay = 0.6;
    if (p.stamina <= 0) p.staminaLock = 0.8;
  } else {
    p.staminaDelay -= dt;
    if (p.staminaDelay <= 0) p.stamina = Math.min(p.maxStamina, p.stamina + 18 * dt);
  }
  if (p.staminaLock > 0) p.staminaLock -= dt;

  if (sliding) {
    // 滑铲：沿开始时的方向滑出去，速度逐渐衰减，方向键只能稍微修正
    const k = p.slide / SLIDE_TIME;
    const sp = BASE_SPEED * g.mods.speed * (1 + (SLIDE_BOOST - 1) * k) * (0.55 + 0.45 * k);
    p.vx = p.slideDirX * sp + mx * 0.6;
    p.vz = p.slideDirZ * sp + mz * 0.6;
  } else {
    // 浅水 / 泥地 / 瓦砾：减速 25%
    const terrain = g.config.extras && g.grid.slow[g.grid.indexAt(p.x, p.z)] ? 0.75 : 1;
    const speed =
      BASE_SPEED *
      terrain *
      wt.speed *
      g.mods.speed *
      (wantSprint ? SPRINT_MULT : 1) *
      (1 - st.adsSlow * p.ads) *
      (1 - (1 - CROUCH_MULT) * (inp.crouch ? 1 : 0)) *
      (g.hz.dazeT > 0 ? DAZE_SLOW : 1) *
      // 卡牌「杀戮冲刺」：刚用枪打死过僵尸
      (g.fx.rush > 0 ? 1 + g.mods.killSpeed : 1) *
      (g.tdm.on && g.tdm.knife ? KNIFE.speed : 1);
    const k = Math.min(1, 14 * dt);
    p.vx += (mx * speed - p.vx) * k;
    p.vz += (mz * speed - p.vz) * k;
  }
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  // 能跳（空格）：脚比矮掩体高的时候它不挡人，落下来站在它顶上。不跳的时候 passAbove 永远是 false，和以前一样
  if (resolveCircleVsGrid(g.grid, p, p.radius, true, false, passAbove(g, p.air)) && sliding) p.slide = Math.min(p.slide, 0.08);
  playerVertical(g, dt);

  // ---- 瞄准 ----
  const ax = inp.aimX - p.x;
  const az = inp.aimZ - p.z;
  if (ax * ax + az * az > 0.04) p.yaw = Math.atan2(ax, az);

  // ---- 近战（V）：打断换弹，短暂不能开火 ----
  if (p.meleeTimer > 0 && !g.tdm.on) {
    const before = p.meleeTimer;
    p.meleeTimer -= dt;
    if (before > MELEE_TIME - MELEE_HIT_AT && p.meleeTimer <= MELEE_TIME - MELEE_HIT_AT) melee(g);
  }
  if (inp.melee && !g.tdm.on) {
    inp.melee = false;
    // V：枪托砸一下（推搡那个带冷却的功能去掉了）
    if (p.meleeTimer <= 0 && !g.buildMode) {
      p.meleeTimer = MELEE_TIME;
      p.reloadTimer = 0;
      p.ads = 0;
      g.events.emit('meleeSwing', {});
    }
  }

  // ---- 换弹与射击 ----
  const slot = g.loadout[p.weapon];
  p.fireTimer = Math.max(-dt, p.fireTimer - dt);
  // 扔手雷抬手时腾不出手开枪
  const canShoot = !g.buildMode && p.meleeTimer <= 0 && p.sprintOut <= 0 && !wantSprint && g.hz.throwT <= 0;

  if (p.reloadTimer > 0) {
    p.reloadTimer -= dt * g.mods.reload;
    if (p.reloadTimer <= 0) {
      p.reloadTimer = 0;
      // 从备弹里补满（不够就补多少算多少）
      slot.mag += g.takeAmmo(p.weapon, st.mag - slot.mag);
      // 冲锋枪 ★1：换完弹 2 秒内射速 +15%
      if (p.weapon === 'smg' && g.config.stars.smg >= 1) p.burstT = STAR_FX.smgBurst.time;
      g.events.emit('reload', { kind: p.weapon, start: false });
    }
    inp.reload = false;
  } else {
    // 要等上一发的射击间隔走完才能开始换弹，这样实测 DPS 和公式一致
    // 没有备弹就换不了（手枪无限）
    const canReload = g.reserveOf(p.weapon) > 0;
    if (p.fireTimer <= 0 && p.meleeTimer <= 0 && canReload && ((inp.reload && slot.mag < st.mag) || slot.mag <= 0)) {
      startReload(g);
    } else if (inp.fire && canShoot && p.fireTimer <= 0 && slot.mag > 0) {
      // 复盘：开火时间按每发占用的射击间隔累加
      g.stats.fireTime[p.weapon] += 1 / (st.rate * (1 + st.ramp * p.ramp) * g.mods.fireRate * burstK(g));
      fireWeapon(g);
      const rate = st.rate * (1 + st.ramp * p.ramp) * g.mods.fireRate * burstK(g);
      p.fireTimer += 1 / rate;
    }
    inp.reload = false;
  }

  // 升星计时：冲锋枪换弹后的加速、轻机枪持续开火时间（松开扳机就清零）
  if (p.burstT > 0) p.burstT = Math.max(0, p.burstT - dt);
  if (inp.fire && canShoot && p.reloadTimer <= 0 && slot.mag > 0) p.sustainT += dt;
  else p.sustainT = 0;
  // 射速递增（过热弹链）：持续射击 2 秒达到上限，松开后很快回落
  if (inp.fire && canShoot && p.reloadTimer <= 0 && slot.mag > 0) p.ramp = Math.min(1, p.ramp + dt / 2);
  else p.ramp = Math.max(0, p.ramp - dt * 1.2);
}

/** 冲锋枪 ★1：换弹后几秒的射速倍率 */
export function burstK(g: Game): number {
  const p = g.player;
  return p.weapon === 'smg' && p.burstT > 0 ? STAR_FX.smgBurst.rate : 1;
}

/** 当前武器的后坐力参数，蹲下 / 瞄准时减小 */
export function recoilScale(g: Game): number {
  const p = g.player;
  return (1 - 0.5 * p.ads) * (1 - 0.25 * p.crouch);
}

