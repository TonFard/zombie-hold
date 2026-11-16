import { clamp } from '../core/math';
import { GUN_BY_ID, type GunDef } from '../data/guns';
import { ARENA_TIER, KNIFE, NADE, arenaStats, reserveFor } from '../data/shop';
import { WEAPON_ORDER, type WeaponKind } from '../data/weapons';
import type { Soldier } from '../entities/soldier';
import type { Game } from '../sim';
import type { Grid } from '../world/grid';
import type { PropKind } from '../world/types';
import { obstruction } from './combat';
import { PLAYER, TDM, holdWeapon, playerPrimary, tdmHurt, type DroppedGun, type TdmGrenade } from './tdm';

/**
 * 8v8 对战里"枪以外"的东西：跳和踩箱子、掉在地上的枪、刀、手雷，以及玩家这几样的按键。
 * 人机怎么用它们在 tdm-ai.ts。
 */

// ---------------------------------------------------------------- 跳、踩在矮掩体上

/** 起跳速度、重力、差多少够得着就算踩上去（米）、两次跳之间至少隔多久 */
export const JUMP = { v: 5.6, g: 15, step: 0.3, cd: 0.3 };

/** 能踩上去的矮东西（顶不超过 1.35 米）。窗台不算：窗洞只有 2.2 米高，人站上去头在墙里 */
const STANDABLE: ReadonlySet<PropKind> = new Set<PropKind>(['crate', 'pallet', 'barrier', 'sandbag', 'barrel', 'dumpster', 'furniture']);
const tops = new WeakMap<Grid, Float32Array>();

/** 每个格子能踩的顶有多高（0 = 不能踩） */
export function standTops(g: Game): Float32Array {
  let m = tops.get(g.grid);
  if (!m) {
    m = new Float32Array(g.grid.count);
    for (const p of g.map.props) {
      if (!p.solid || !STANDABLE.has(p.kind)) continue;
      for (let y = p.y0; y < p.y1; y++) {
        for (let x = p.x0; x < p.x1; x++) {
          const i = g.grid.idx(x, y);
          const h = g.grid.height[i] as number;
          if (h > 0.3 && h <= 1.35) m[i] = h;
        }
      }
    }
    tops.set(g.grid, m);
  }
  return m;
}

export const topAt = (g: Game, cx: number, cy: number): number => (g.grid.inBounds(cx, cy) ? (standTops(g)[g.grid.idx(cx, cy)] as number) : 0);

/** 碰撞时哪些格子不挡人：脚已经比它的顶高了，或者只差一点（跳起来扒一下就上去了） */
export const passAbove =
  (g: Game, y: number) =>
  (cx: number, cy: number): boolean => {
    const t = topAt(g, cx, cy);
    return t > 0 && t <= y + JUMP.step;
  };

/** 这一格的东西有多高（挡手雷用）：空地 0；细柱子（灯杆、树）不算 */
export function heightAt(g: Game, x: number, z: number): number {
  const cx = g.grid.cellX(x);
  const cy = g.grid.cellY(z);
  if (!g.grid.inBounds(cx, cy)) return 99;
  const i = g.grid.idx(cx, cy);
  if (!g.grid.solid[i] || (g.grid.post[i] as number) > 0) return 0;
  return (g.grid.height[i] as number) || 3.4;
}

const _v = { y: 0, vy: 0, landed: false };
/**
 * 竖直方向走一步（水平方向已经挪完、碰撞也解过了）：起跳以后往上、往下掉，脚下是能踩的东西就站在它顶上。
 * 返回的对象是共用的，马上读走
 */
export function stepVertical(g: Game, x: number, z: number, y: number, vy: number, dt: number): { y: number; vy: number; landed: boolean } {
  const t = topAt(g, g.grid.cellX(x), g.grid.cellY(z));
  const ground = t > 0 && t <= y + JUMP.step ? t : 0;
  let landed = false;
  if (y < ground) {
    y = ground;
    if (vy < 0) vy = 0;
  }
  if (y > ground || vy > 0) {
    vy -= JUMP.g * dt;
    y += vy * dt;
    if (y <= ground) {
      landed = vy < -2.5;
      y = ground;
      vy = 0;
    }
  }
  _v.y = y;
  _v.vy = vy;
  _v.landed = landed;
  return _v;
}

/** 脚踩在实处（地面或者箱子顶上） */
export const grounded = (g: Game, x: number, z: number, y: number, vy: number): boolean => {
  if (vy !== 0) return false;
  const t = topAt(g, g.grid.cellX(x), g.grid.cellY(z));
  return y <= (t > 0 && t <= y + JUMP.step ? t : 0) + 1e-3;
};

/** 玩家是不是在半空（对战里开枪散得很开；打僵尸时跳着打不罚） */
export const playerAirborne = (g: Game): boolean => g.tdm.on && !grounded(g, g.player.x, g.player.z, g.player.air, g.player.vy);

/** 玩家的跳：水平移动之后调。守城 / 训练场里也用这一套（那边没有冻结时间，只有选卡的时候不能跳） */
export function playerVertical(g: Game, dt: number): void {
  const p = g.player;
  const inp = g.input;
  const t = g.tdm;
  t.jumpCd = Math.max(0, t.jumpCd - dt);
  if (inp.jump) {
    inp.jump = false;
    const frozen = t.on ? t.phase === 'freeze' : g.run.phase === 'menu' || g.run.phase === 'cards';
    const onGround = grounded(g, p.x, p.z, p.air, p.vy);
    // 卡牌「二段跳」：人在空中还能再跳（对战不吃卡牌，mods.airJumps 一直是 0）
    const airJump = !onGround && g.fx.airJumps < g.mods.airJumps;
    if (!frozen && ((onGround && t.jumpCd <= 0) || airJump)) {
      if (airJump) g.fx.airJumps++;
      p.vy = JUMP.v;
      t.jumpCd = JUMP.cd;
      g.events.emit('tdmJump', { id: PLAYER, land: false, x: p.x, z: p.z });
    }
  }
  const r = stepVertical(g, p.x, p.z, p.air, p.vy, dt);
  p.air = r.y;
  p.vy = r.vy;
  if (p.vy === 0 && g.fx.airJumps > 0 && grounded(g, p.x, p.z, p.air, p.vy)) g.fx.airJumps = 0;
  if (r.landed) g.events.emit('tdmJump', { id: PLAYER, land: true, x: p.x, z: p.z });
}

// ---------------------------------------------------------------- 掉在地上的枪

/** 一把枪掉在 (x, z) 附近：落点不能在墙里；地上最多留 40 把 */
export function dropGun(g: Game, gun: string, x: number, z: number, yaw: number, mag: number, reserve: number, y0 = 1.1): void {
  const t = g.tdm;
  let px = x;
  let pz = z;
  for (let i = 0; i < 6 && g.grid.isBlocked(g.grid.cellX(px), g.grid.cellY(pz)); i++) {
    px = x + (g.rng.next() - 0.5) * 1.2;
    pz = z + (g.rng.next() - 0.5) * 1.2;
  }
  if (g.grid.isBlocked(g.grid.cellX(px), g.grid.cellY(pz))) return;
  t.drops.push({ id: t.nextDropId++, gun, x: px, z: pz, yaw, mag, reserve, t: 0, y0 });
  if (t.drops.length > 40) t.drops.shift();
}

const clsOf = (gun: string): WeaponKind => (GUN_BY_ID[gun] as GunDef).cls;

/** 玩家脚边能捡的那一把：1.7 米内最近的，和自己同一个枪位上已经拿着的同一型号不算 */
export function pickupCandidate(g: Game): DroppedGun | null {
  const p = g.player;
  let best: DroppedGun | null = null;
  let bestD = 1.7;
  for (const d of g.tdm.drops) {
    if (d.t < 0.35) continue;
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist >= bestD) continue;
    const cls = clsOf(d.gun);
    if (g.loadout[cls].owned && g.config.guns[cls] === d.gun) continue;
    best = d;
    bestD = dist;
  }
  return best;
}

/** 玩家按 E：捡起脚边的枪，同一个枪位上原来的那把扔在地上 */
export function playerPickup(g: Game): boolean {
  const t = g.tdm;
  const p = g.player;
  const d = t.drops.find((x) => x.id === t.pickup);
  if (!d || !p.alive || t.swingT >= 0) return false;
  const cls = clsOf(d.gun);
  const old = cls === 'pistol' ? 'pistol' : playerPrimary(g);
  t.drops.splice(t.drops.indexOf(d), 1);
  if (old && g.loadout[old].owned) {
    dropGun(g, g.config.guns[old], p.x + Math.sin(p.yaw) * 0.5, p.z + Math.cos(p.yaw) * 0.5, p.yaw + 1.2, g.loadout[old].mag, t.reserve[old], 0.9);
    if (old !== cls) g.loadout[old].owned = g.loadout[old].carried = false;
  }
  g.config.guns[cls] = d.gun;
  const slot = g.loadout[cls];
  slot.owned = slot.carried = true;
  slot.tier = ARENA_TIER;
  slot.mag = Math.min(d.mag, arenaStats(d.gun).mag);
  t.reserve[cls] = d.reserve;
  t.knife = false;
  t.pickup = null;
  // 同一类的枪换了型号：强制重新举枪（holdWeapon 里只在换了类别时才发事件）
  holdWeapon(g, cls);
  g.events.emit('tdmPickup', { gun: d.gun });
  return true;
}

/** 人机捡枪：手里的换成地上的（主武器换主武器；手里是手枪的话手枪收到身上，身上那把打空的长枪扔掉） */
export function soldierPickup(g: Game, s: Soldier, d: DroppedGun): void {
  const t = g.tdm;
  const i = t.drops.indexOf(d);
  if (i < 0) return;
  t.drops.splice(i, 1);
  if (s.weapon === 'pistol') {
    if (s.alt) dropGun(g, s.alt.gun, s.x, s.z, s.yaw + 1.2, s.alt.mag, s.alt.reserve, 0.9);
    s.alt = { gun: s.gun, mag: s.mag, reserve: s.reserve };
  } else dropGun(g, s.gun, s.x, s.z, s.yaw + 1.2, s.mag, s.reserve, 0.9);
  s.gun = d.gun;
  s.weapon = clsOf(d.gun);
  s.mag = Math.min(d.mag, arenaStats(d.gun).mag);
  s.reserve = d.reserve;
  s.reloadT = 0;
  s.knife = false;
  s.drawT = 0.5;
}

// ---------------------------------------------------------------- 刀

/**
 * 挥到了该打中的那一下：前方扇形里最近的一个敌人挨刀。从背后（对方背对着自己）伤害高得多，捅是一刀毙命。
 * owner = 谁挥的（士兵 id，-1 = 玩家），y = 他的脚有多高
 */
export function knifeHit(g: Game, owner: number, team: 0 | 1, x: number, z: number, y: number, yaw: number, stab: boolean): boolean {
  const k = stab ? KNIFE.stab : KNIFE.slash;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  let best = -2;
  let bestD = 1e9;
  let bestYaw = 0;
  let bx = 0;
  let bz = 0;
  const test = (id: number, ex: number, ez: number, ey: number, eyaw: number): void => {
    const dx = ex - x;
    const dz = ez - z;
    const dist = Math.hypot(dx, dz);
    const d = dist - TDM.radius;
    if (d > k.range || d >= bestD || Math.abs(ey - y) > 1.2) return;
    if (dist > 0.3 && Math.acos(clamp((dx * fx + dz * fz) / dist, -1, 1)) > KNIFE.arc) return;
    if (!g.grid.segmentClear(x, z, ex, ez, false) && Math.max(y, ey) < 0.5) return;
    best = id;
    bestD = d;
    bestYaw = eyaw;
    bx = ex;
    bz = ez;
  };
  for (const s of g.tdm.soldiers) if (s.alive && s.team !== team && s.id !== owner) test(s.id, s.x, s.z, s.y, s.yaw);
  const p = g.player;
  if (p.alive && team !== 0 && owner !== PLAYER) test(PLAYER, p.x, p.z, p.air, p.yaw);
  if (best === -2) return false;
  // 背后：对方脸朝的方向和自己挥刀的方向差不多
  const back = Math.sin(bestYaw) * fx + Math.cos(bestYaw) * fz > 0.45;
  g.events.emit('tdmStab', { id: owner, victim: best, back, x: bx - fx * TDM.radius, y: y + 1.15, z: bz - fz * TDM.radius });
  tdmHurt(g, best, back ? k.back : k.damage, false, { owner, name: '匕首', reward: KNIFE.reward }, fx, fz);
  return true;
}

// ---------------------------------------------------------------- 手雷

const NADE_G = 12;

/** 扔一颗手雷：从 (x, y, z) 沿 (yaw, pitch) 出手 */
export function throwNade(g: Game, owner: number, team: 0 | 1, x: number, y: number, z: number, yaw: number, pitch: number, speed: number = NADE.speed, vx0 = 0, vz0 = 0): void {
  const cp = Math.cos(pitch);
  g.tdm.grenades.push({ x, y, z, vx: Math.sin(yaw) * cp * speed + vx0, vy: Math.sin(pitch) * speed, vz: Math.cos(yaw) * cp * speed + vz0, fuse: NADE.fuse, owner, team });
}

/** 要把雷扔到水平 d 米远、比出手点低 drop 米的地方，用多大的仰角（低抛）。够不着返回 null */
export function lobPitch(d: number, drop: number, speed: number = NADE.speed): number | null {
  const v2 = speed * speed;
  const disc = v2 * v2 - NADE_G * (NADE_G * d * d - 2 * drop * v2);
  if (disc < 0) return null;
  return Math.atan2(v2 - Math.sqrt(disc), NADE_G * d);
}

/** 按这个角度扔出去，飞到 d 米远之前会不会撞上东西（撞上就弹回来了，不扔） */
export function arcClear(g: Game, x: number, y: number, z: number, yaw: number, pitch: number, d: number, speed: number = NADE.speed): boolean {
  const vh = Math.cos(pitch) * speed;
  const vy = Math.sin(pitch) * speed;
  const sx = Math.sin(yaw);
  const sz = Math.cos(yaw);
  for (let r = 0.8; r < d - 1.5; r += 0.5) {
    const tt = r / vh;
    if (heightAt(g, x + sx * r, z + sz * r) > y + vy * tt - 0.5 * NADE_G * tt * tt - 0.15) return false;
  }
  return true;
}

function explode(g: Game, n: TdmGrenade): void {
  g.events.emit('explosion', { x: n.x, z: n.z, radius: NADE.radius * 0.55, big: true });
  const src = { owner: n.owner, name: '手雷', reward: NADE.reward };
  const hit = (id: number, x: number, z: number, y: number, self: boolean): void => {
    const dx = x - n.x;
    const dz = z - n.z;
    const d = Math.hypot(dx, dz);
    if (d >= NADE.radius) return;
    // 中间隔着墙 / 箱子就炸不到
    if (obstruction(g, n.x, n.y + 0.4, n.z, dx, y + 1.0 - (n.y + 0.4), dz)) return;
    const k = 1 - d / NADE.radius;
    tdmHurt(g, id, NADE.damage * k * (self ? 0.6 : 1), false, src, dx / (d || 1), dz / (d || 1));
  };
  // 不伤队友，会伤到自己
  for (const s of [...g.tdm.soldiers]) if (s.alive && (s.team !== n.team || s.id === n.owner)) hit(s.id, s.x, s.z, s.y, s.id === n.owner);
  const p = g.player;
  if (p.alive && (n.team !== 0 || n.owner === PLAYER)) hit(PLAYER, p.x, p.z, p.air, n.owner === PLAYER);
}

/** 手雷飞、弹、炸 */
export function updateNades(g: Game, dt: number): void {
  const list = g.tdm.grenades;
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i] as TdmGrenade;
    n.fuse -= dt;
    if (n.fuse <= 0) {
      list.splice(i, 1);
      explode(g, n);
      continue;
    }
    // 碰到比它高的东西弹回来
    const nx = n.x + n.vx * dt;
    if (heightAt(g, nx, n.z) > n.y) n.vx *= -0.45;
    else n.x = nx;
    const nz = n.z + n.vz * dt;
    if (heightAt(g, n.x, nz) > n.y) n.vz *= -0.45;
    else n.z = nz;
    n.vy -= NADE_G * dt;
    n.y += n.vy * dt;
    const floor = heightAt(g, n.x, n.z) + 0.06;
    if (n.y <= floor) {
      n.y = floor;
      n.vy = Math.abs(n.vy) * 0.32;
      if (n.vy < 0.6) n.vy = 0;
      n.vx *= 0.55;
      n.vz *= 0.55;
    }
  }
}

// ---------------------------------------------------------------- 玩家的按键

const swingDur = (kind: 0 | 1 | 2): number => (kind === 2 ? KNIFE.stab.dur : KNIFE.slash.dur);

function startSwing(g: Game, kind: 0 | 1 | 2, quick: boolean): void {
  const t = g.tdm;
  const p = g.player;
  t.swingT = 0;
  t.swingKind = kind;
  t.swingDur = swingDur(kind);
  t.swingQuick = quick;
  t.swingHit = false;
  p.reloadTimer = 0;
  p.ads = 0;
  g.events.emit('tdmSwing', { id: PLAYER, kind, x: p.x, z: p.z });
}

/** 把刀收起来、枪拿回手里 */
function sheathe(g: Game): void {
  const t = g.tdm;
  if (!t.knife) return;
  t.knife = false;
  g.player.fireTimer = Math.max(g.player.fireTimer, KNIFE.draw);
  g.events.emit('weaponSwitch', { kind: g.player.weapon });
}

function drawKnife(g: Game): void {
  const t = g.tdm;
  if (t.knife) return;
  t.knife = true;
  g.player.reloadTimer = 0;
  g.player.ads = 0;
  g.events.emit('weaponSwitch', { kind: g.player.weapon });
}

/**
 * 玩家在对战里多出来的按键（updatePlayer 开头调，人活着的时候）：
 * 1 主武器 / 2 手枪 / 3 刀，Q 换回上一把，滚轮三样轮着换；V 抽刀挥一下；拿着刀时左键横挥、右键捅；G 扔手雷。
 * 拿着刀 / 正在挥 / 正在扔的时候把开火和瞄准吃掉，后面的开枪逻辑就不会动
 */
export function tdmPlayerInput(g: Game, dt: number): void {
  const t = g.tdm;
  const p = g.player;
  const inp = g.input;
  const live = t.phase === 'live';
  const swinging = t.swingT >= 0;
  const primary = playerPrimary(g);

  // ---- 换武器 ----
  const gun = (k: WeaponKind | null): void => {
    if (!k || swinging) return;
    sheathe(g);
    if (k !== p.weapon) holdWeapon(g, k);
  };
  if (inp.select > 0) {
    if (inp.select === 1) gun(primary);
    else if (inp.select === 2) gun('pistol');
    else if (inp.select === 3 && !swinging) drawKnife(g);
    inp.select = 0;
  }
  if (inp.pulse) {
    inp.pulse = false;
    if (t.knife) sheathe(g);
    else if (primary) gun(p.weapon === 'pistol' ? primary : 'pistol');
    else if (!swinging) drawKnife(g);
  }
  if (inp.cycle !== 0) {
    const order: Array<WeaponKind | 'knife'> = primary ? [primary, 'pistol', 'knife'] : ['pistol', 'knife'];
    const cur = t.knife ? 'knife' : p.weapon;
    const next = order[(order.indexOf(cur) + inp.cycle + order.length) % order.length] as WeaponKind | 'knife';
    if (next === 'knife') {
      if (!swinging) drawKnife(g);
    } else gun(next);
    inp.cycle = 0;
  }

  // ---- 刀 ----
  if (t.swingT >= 0) {
    const k = t.swingKind === 2 ? KNIFE.stab : KNIFE.slash;
    t.swingT += dt;
    if (!t.swingHit && t.swingT >= k.hitAt) {
      t.swingHit = true;
      knifeHit(g, PLAYER, 0, p.x, p.z, p.air, p.yaw, t.swingKind === 2);
    }
    if (t.swingT >= t.swingDur) {
      t.swingT = -1;
      if (t.swingQuick) p.fireTimer = Math.max(p.fireTimer, 0.15);
    }
  }
  const idle = t.swingT < 0 && g.hz.throwT <= 0;
  if (inp.melee) {
    inp.melee = false;
    if (live && idle) startSwing(g, t.swingKind === 0 ? 1 : 0, !t.knife);
  }
  if (t.knife && live && idle) {
    if (inp.ads) startSwing(g, 2, false);
    else if (inp.fire) startSwing(g, t.swingKind === 0 ? 1 : 0, false);
  }
  // 现有的开枪逻辑看 meleeTimer > 0 就不开火、不能冲刺
  p.meleeTimer = t.swingT >= 0 ? Math.max(0.01, t.swingDur - t.swingT) : 0;

  // ---- 手雷 ----
  if (inp.grenade) {
    inp.grenade = false;
    if (live && t.nades > 0 && idle) {
      g.hz.throwT = NADE.windup;
      g.events.emit('grenadeWindup', { fire: false });
    }
  }
  if (g.hz.throwT > 0) {
    g.hz.throwT -= dt;
    if (g.hz.throwT <= 0) {
      g.hz.throwT = 0;
      if (t.nades > 0 && live) {
        t.nades--;
        throwNade(g, PLAYER, 0, p.x + Math.sin(p.yaw) * 0.4, p.air + p.eye - 0.1, p.z + Math.cos(p.yaw) * 0.4, p.yaw, inp.aimPitch + 0.2, NADE.speed, p.vx * 0.5, p.vz * 0.5);
        g.events.emit('grenadeThrown', { fire: false });
        p.fireTimer = Math.max(p.fireTimer, NADE.cd);
      }
    }
  }

  if (t.knife || t.swingT >= 0 || g.hz.throwT > 0) {
    inp.fire = false;
    inp.ads = false;
    inp.reload = false;
  }
  const c = pickupCandidate(g);
  t.pickup = c ? c.id : null;
}

/** 这一局开始时玩家身上的枪各补满弹匣和备弹（没有的那几类清零） */
export function refillPlayer(g: Game): void {
  const t = g.tdm;
  for (const k of WEAPON_ORDER) {
    const slot = g.loadout[k];
    t.reserve[k] = slot.owned ? reserveFor(g.config.guns[k]) : 0;
    if (slot.owned) slot.mag = arenaStats(g.config.guns[k]).mag;
  }
}
