import { WEAPON_ORDER, statsAt, type WeaponKind } from '../data/weapons';
import { resolveCircleVsGrid } from '../world/collision';
import type { Game } from '../sim';
import { fireWeapon } from './combat';

const BASE_SPEED = 3.4;
const SPRINT_MULT = 1.5;

function startReload(g: Game): void {
  const p = g.player;
  const st = statsAt(p.weapon, p.tier);
  p.reloadTimer = Math.max(0.01, st.reload);
  g.events.emit('reload', { kind: p.weapon, start: true });
}

export function switchWeapon(g: Game, kind: WeaponKind): void {
  const p = g.player;
  const slot = g.loadout[kind];
  if (!slot.owned || kind === p.weapon) return;
  p.weapon = kind;
  p.tier = slot.tier;
  p.reloadTimer = 0; // 切枪打断换弹
  p.fireTimer = 0.25; // 举枪时间
  p.ramp = 0;
  g.events.emit('weaponSwitch', { kind });
}

/** 玩家移动、瞄准、切枪、换弹、射击 */
export function updatePlayer(g: Game, dt: number): void {
  const p = g.player;
  const inp = g.input;

  if (!p.alive) {
    p.vx = 0;
    p.vz = 0;
    inp.select = 0;
    inp.reload = false;
    return;
  }

  // ---- 切枪 ----
  if (inp.select > 0) {
    const k = WEAPON_ORDER[inp.select - 1];
    if (k) switchWeapon(g, k);
    inp.select = 0;
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
  const wantSprint = inp.sprint && moving && p.stamina > 0 && p.staminaLock <= 0;
  p.sprinting = wantSprint;
  if (wantSprint) {
    p.stamina = Math.max(0, p.stamina - 25 * g.mods.staminaUse * dt);
    p.staminaDelay = 0.6;
    if (p.stamina <= 0) p.staminaLock = 0.8;
  } else {
    p.staminaDelay -= dt;
    if (p.staminaDelay <= 0) p.stamina = Math.min(p.maxStamina, p.stamina + 18 * dt);
  }
  if (p.staminaLock > 0) p.staminaLock -= dt;
  const speed = BASE_SPEED * g.mods.speed * (wantSprint ? SPRINT_MULT : 1);
  const k = Math.min(1, 14 * dt);
  p.vx += (mx * speed - p.vx) * k;
  p.vz += (mz * speed - p.vz) * k;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  resolveCircleVsGrid(g.grid, p, p.radius);

  // ---- 瞄准 ----
  const ax = inp.aimX - p.x;
  const az = inp.aimZ - p.z;
  if (ax * ax + az * az > 0.04) p.yaw = Math.atan2(ax, az);

  // ---- 换弹与射击 ----
  const st = statsAt(p.weapon, p.tier);
  const slot = g.loadout[p.weapon];
  p.fireTimer = Math.max(-dt, p.fireTimer - dt);

  if (p.reloadTimer > 0) {
    p.reloadTimer -= dt * g.mods.reload;
    if (p.reloadTimer <= 0) {
      p.reloadTimer = 0;
      slot.mag = st.mag;
      g.events.emit('reload', { kind: p.weapon, start: false });
    }
    inp.reload = false;
  } else {
    // 要等上一发的射击间隔走完才能开始换弹，这样实测 DPS 和公式一致
    if (p.fireTimer <= 0 && ((inp.reload && slot.mag < st.mag) || slot.mag <= 0)) {
      startReload(g);
    } else if (inp.fire && !g.buildMode && p.fireTimer <= 0 && slot.mag > 0) {
      fireWeapon(g);
      const rate = st.rate * (1 + st.ramp * p.ramp);
      p.fireTimer += 1 / rate;
    }
    inp.reload = false;
  }

  // 射速递增（过热弹链）：持续射击 2 秒达到上限，松开后很快回落
  if (inp.fire && !g.buildMode && p.reloadTimer <= 0 && slot.mag > 0) p.ramp = Math.min(1, p.ramp + dt / 2);
  else p.ramp = Math.max(0, p.ramp - dt * 1.2);
}
