import { clamp } from '../core/math';
import type { Zombie } from '../entities/zombie';
import type { Game } from '../sim';
import { HALF_H, HALF_W } from '../world/grid';

/**
 * 地面危险区（酸池 / 火焰地面）、吐酸者的酸团、可射击的爆炸物、手雷、推搡、发电机电击脉冲。
 * 这些都是"范围伤害 + 持续时间"的东西，放在一起；状态都挂在 Game 上，检查点会一起保存。
 */

// ---------------------------------------------------------------- 数值

/** 爆炸物：油桶 / 加油机 / 车辆。伤害对僵尸和玩家都生效 */
export const EXPLOSIVE = {
  barrel: { hp: 40, radius: 3, damage: 140, fire: 4 },
  pump: { hp: 120, radius: 3.6, damage: 180, fire: 4 },
  car: { hp: 260, radius: 3.4, damage: 160, fire: 4 },
} as const;
export type ExplosiveKind = keyof typeof EXPLOSIVE;
/** 爆炸物对玩家的伤害倍率（站得近也不至于秒死） */
export const EXPLOSIVE_PLAYER_MULT = 0.35;

/** 火焰地面：每秒伤害；酸池：每秒伤害；毒雾（毒雾者死后留下的，只伤玩家）：每秒伤害 */
export const FIRE_DPS = 18;
export const ACID_DPS = 14;
export const GAS_DPS = 9;

/** 手雷：每个白天补到爆炸 2 颗、燃烧 1 颗；投掷速度、引信、爆炸 / 燃烧 */
export const GRENADE = { max: 2, fireMax: 1, speed: 14, fuse: 1.6, windup: 0.45, cd: 1.6, frag: { radius: 3.6, damage: 160 }, fire: { radius: 3, damage: 40, burn: 4, dps: 22 } };

/** 推搡：冷却、范围、击退、硬直 */
export const SHOVE = { cd: 4, range: 2.0, arc: 70 * (Math.PI / 180), push: 5, stun: 1 };

/** 发电机电击脉冲：触发距离、充能、半径、伤害、眩晕、冷却 */
export const PULSE = { reach: 6, charge: 1.5, radius: 8, damage: 40, stun: 2, cd: 60 };

/** 吐酸者的酸团：飞行速度、落点酸池半径 / 持续、直接命中伤害 */
export const SPIT = { speed: 9, pool: 1.3, life: 4, hit: 12 };

// ---------------------------------------------------------------- 状态

export interface Hazard {
  kind: 'fire' | 'acid' | 'gas';
  x: number;
  z: number;
  r: number;
  life: number;
}

export interface Explosive {
  kind: ExplosiveKind;
  /** 占的格子 [x0,x1) × [y0,y1) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x: number;
  z: number;
  hp: number;
  alive: boolean;
}

export interface Spit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Thrown {
  fire: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
}

/** 首领抛出来的东西的落点：地上先画预警圈，t 秒后落下。rock = 碎石（砸人、砸建筑），acid = 酸弹（留酸池） */
export interface Mark {
  kind: 'rock' | 'acid';
  x: number;
  z: number;
  r: number;
  t: number;
  damage: number;
}

export interface HazardState {
  hazards: Hazard[];
  explosives: Explosive[];
  spits: Spit[];
  thrown: Thrown[];
  marks: Mark[];
  /** 被哀嚎女王的尖啸震住：剩余时间（移动变慢、画面晃） */
  dazeT: number;
  /** 手雷数量（爆炸 / 燃烧） */
  frags: number;
  fires: number;
  /** 下一颗扔燃烧弹（G 切换种类在界面上做） */
  useFire: boolean;
  shoveCd: number;
  /** 投掷：拉环 / 抬手的剩余时间（> 0 正在扔，到 0 才出手），投掷冷却 */
  throwT: number;
  throwCd: number;
  /** 电击脉冲：充能剩余（> 0 正在充能）、冷却剩余 */
  pulseCharge: number;
  pulseCd: number;
}

export function newHazards(): HazardState {
  return { hazards: [], explosives: [], spits: [], thrown: [], marks: [], dazeT: 0, frags: GRENADE.max, fires: GRENADE.fireMax, useFire: false, shoveCd: 0, throwT: 0, throwCd: 0, pulseCharge: 0, pulseCd: 0 };
}

/** 被震慑时玩家的移动速度倍率 */
export const DAZE_SLOW = 0.55;

const GRAVITY = 9.8;

// ---------------------------------------------------------------- 爆炸物

/** 开局时从地图道具里登记爆炸物（油桶、加油机、车辆） */
export function registerExplosives(g: Game): void {
  const h = g.hz;
  h.explosives.length = 0;
  for (const p of g.map.props) {
    if (p.kind !== 'barrel' && p.kind !== 'pump' && p.kind !== 'car') continue;
    const def = EXPLOSIVE[p.kind];
    h.explosives.push({ kind: p.kind, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, x: (p.x0 + p.x1) / 2 - HALF_W, z: (p.y0 + p.y1) / 2 - HALF_H, hp: def.hp, alive: true });
  }
}

/** 这一格是不是一个还没炸的爆炸物 */
export function explosiveAt(g: Game, cx: number, cy: number): Explosive | null {
  for (const e of g.hz.explosives) if (e.alive && cx >= e.x0 && cx < e.x1 && cy >= e.y0 && cy < e.y1) return e;
  return null;
}

/** 子弹 / 爆炸打在爆炸物上 */
export function damageExplosive(g: Game, e: Explosive, amount: number): void {
  if (!e.alive) return;
  e.hp -= amount;
  if (e.hp <= 0) detonate(g, e);
}

function detonate(g: Game, e: Explosive): void {
  e.alive = false;
  const def = EXPLOSIVE[e.kind];
  g.events.emit('propExploded', { index: g.hz.explosives.indexOf(e), x: e.x, z: e.z });
  blast(g, e.x, e.z, def.radius, def.damage, true);
  g.hz.hazards.push({ kind: 'fire', x: e.x, z: e.z, r: def.radius * 0.55, life: def.fire });
}

/**
 * 范围爆炸：伤害僵尸（距离衰减到 40%）、可选伤害玩家、连锁引爆附近的爆炸物、伤害建筑。
 * 和榴弹的 explode() 分开：那个只打僵尸，且要保持 M7 时的数值。
 */
export function blast(g: Game, x: number, z: number, radius: number, damage: number, hurtsPlayer: boolean, src: 'explosive' | 'grenade' = 'explosive'): void {
  g.events.emit('explosion', { x, z, radius, big: true });
  for (const zb of g.zombies) {
    if (!zb.alive) continue;
    const dx = zb.x - x;
    const dz = zb.z - z;
    const d = Math.hypot(dx, dz) - zb.radius;
    if (d > radius) continue;
    const f = 1 - 0.6 * clamp(d / radius, 0, 1);
    const len = Math.hypot(dx, dz) || 1;
    g.damageZombie(zb, damage * f, { kx: (dx / len) * 3, kz: (dz / len) * 3, src });
  }
  const p = g.player;
  if (hurtsPlayer && p.alive) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < radius) g.damagePlayer(damage * EXPLOSIVE_PLAYER_MULT * (1 - 0.6 * (d / radius)));
  }
  for (const s of [...g.structures.values()]) {
    const d = Math.hypot(s.cx - HALF_W + 0.5 - x, s.cy - HALF_H + 0.5 - z);
    if (d < radius * 0.7) g.damageStructure(s.id, damage * 0.4);
  }
  // 连锁：范围内的其他爆炸物也会被引爆（下一次结算时，避免递归太深）
  for (const e of g.hz.explosives) {
    if (e.alive && Math.hypot(e.x - x, e.z - z) < radius + 0.6) e.hp = Math.min(e.hp, 0.5);
  }
  igniteGas(g, x, z, radius * 0.6);
}

// ---------------------------------------------------------------- 手雷 / 推搡 / 脉冲

/** G：扔一颗手雷（沿视线方向抛物线飞），返回是否扔出 */
/**
 * 按 G：先拉环抬手（GRENADE.windup 秒，期间不能开火），然后才出手；扔完有 GRENADE.cd 秒冷却。
 * 以前按下立刻扔、没有冷却，连按几下一口气全扔出去
 */
export function throwGrenade(g: Game): boolean {
  const h = g.hz;
  const p = g.player;
  const fire = h.useFire && h.fires > 0;
  if (!p.alive || h.throwT > 0 || h.throwCd > 0 || (fire ? h.fires : h.frags) <= 0) return false;
  h.throwT = GRENADE.windup;
  g.events.emit('grenadeWindup', { fire });
  return true;
}

/** 抬手结束，真正把手雷扔出去（方向按出手这一刻的视线） */
function releaseGrenade(g: Game): void {
  const h = g.hz;
  const p = g.player;
  h.throwCd = GRENADE.cd;
  const fire = h.useFire && h.fires > 0;
  if (!p.alive || (fire ? h.fires : h.frags) <= 0) return;
  if (fire) h.fires--;
  else h.frags--;
  const pitch = g.input.aimPitch + 0.25;
  const cp = Math.cos(pitch);
  h.thrown.push({ fire, x: p.x + Math.sin(p.yaw) * 0.4, y: p.eye - 0.1, z: p.z + Math.cos(p.yaw) * 0.4, vx: Math.sin(p.yaw) * cp * GRENADE.speed + p.vx * 0.5, vy: Math.sin(pitch) * GRENADE.speed, vz: Math.cos(p.yaw) * cp * GRENADE.speed + p.vz * 0.5, fuse: GRENADE.fuse });
  g.events.emit('grenadeThrown', { fire });
}

/** 推搡：前方扇形内的僵尸被推开并硬直 1 秒 */
export function shove(g: Game): number {
  const h = g.hz;
  const p = g.player;
  if (!p.alive || h.shoveCd > 0) return 0;
  h.shoveCd = SHOVE.cd * g.mods.shoveCd;
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  let n = 0;
  for (const z of g.zombies) {
    if (!z.alive) continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d - z.radius > SHOVE.range) continue;
    const a = Math.acos(clamp((dx * fx + dz * fz) / (d || 1), -1, 1));
    if (a > SHOVE.arc) continue;
    const mass = (z.radius / 0.32) ** 2;
    z.kbx += ((dx / (d || 1)) * SHOVE.push) / mass;
    z.kbz += ((dz / (d || 1)) * SHOVE.push) / mass;
    z.stunT = Math.max(z.stunT, z.def.boss ? SHOVE.stun * 0.3 : SHOVE.stun);
    n++;
  }
  g.events.emit('shove', { hits: n });
  return n;
}

/** Q：在发电机附近开始充能电击脉冲 */
export function startPulse(g: Game): boolean {
  const h = g.hz;
  const p = g.player;
  if (!p.alive || h.pulseCd > 0 || h.pulseCharge > 0) return false;
  if (Math.hypot(p.x - g.core.x, p.z - g.core.z) > PULSE.reach) return false;
  h.pulseCharge = PULSE.charge;
  g.events.emit('pulse', { stage: 'charge', x: g.core.x, z: g.core.z, radius: PULSE.radius });
  return true;
}

function firePulse(g: Game): void {
  const h = g.hz;
  h.pulseCd = PULSE.cd;
  g.events.emit('pulse', { stage: 'fire', x: g.core.x, z: g.core.z, radius: PULSE.radius });
  for (const z of g.zombies) {
    if (!z.alive || Math.hypot(z.x - g.core.x, z.z - g.core.z) - z.radius > PULSE.radius) continue;
    z.stunT = Math.max(z.stunT, PULSE.stun);
    g.damageZombie(z, PULSE.damage, { src: 'pulse' });
  }
}

// ---------------------------------------------------------------- 吐酸者

/** 吐一团酸：瞄准目标的落点，抛物线飞 */
export function spitAt(g: Game, z: Zombie, tx: number, tz: number): void {
  const dx = tx - z.x;
  const dz = tz - z.z;
  const d = Math.hypot(dx, dz) || 1;
  const T = d / SPIT.speed;
  const y0 = 1.4;
  g.hz.spits.push({ x: z.x + (dx / d) * 0.4, y: y0, z: z.z + (dz / d) * 0.4, vx: dx / T, vy: (-y0 + 0.5 * GRAVITY * T * T) / T, vz: dz / T });
  g.events.emit('spit', { x: z.x, z: z.z });
}

function landSpit(g: Game, s: Spit): void {
  g.hz.hazards.push({ kind: 'acid', x: s.x, z: s.z, r: SPIT.pool, life: SPIT.life });
  g.events.emit('acid', { x: s.x, z: s.z, radius: SPIT.pool });
  const p = g.player;
  if (p.alive && Math.hypot(p.x - s.x, p.z - s.z) < SPIT.pool) g.damagePlayer(SPIT.hit);
  for (const st of [...g.structures.values()]) {
    if (Math.hypot(st.cx - HALF_W + 0.5 - s.x, st.cy - HALF_H + 0.5 - s.z) < SPIT.pool + 0.3) g.damageStructure(st.id, SPIT.hit * 2);
  }
}

// ---------------------------------------------------------------- 首领的抛射

/** 落下：圈里的玩家吃满伤害（预警圈就是躲的提示），建筑吃双倍；酸弹留下酸池 */
function landMark(g: Game, m: Mark): void {
  const p = g.player;
  const d = Math.hypot(p.x - m.x, p.z - m.z);
  if (p.alive && d < m.r + p.radius) {
    g.damagePlayer(m.damage * g.config.zombieDamage);
    if (m.kind === 'rock') {
      p.vx += ((p.x - m.x) / (d || 1)) * 4;
      p.vz += ((p.z - m.z) / (d || 1)) * 4;
    }
  }
  for (const s of [...g.structures.values()]) {
    if (Math.hypot(s.cx - HALF_W + 0.5 - m.x, s.cy - HALF_H + 0.5 - m.z) < m.r + 0.5) g.damageStructure(s.id, m.damage * 2);
  }
  if (m.kind === 'acid') {
    g.hz.hazards.push({ kind: 'acid', x: m.x, z: m.z, r: m.r * 0.85, life: 4 });
    g.events.emit('acid', { x: m.x, z: m.z, radius: m.r });
  }
  g.events.emit('markHit', { kind: m.kind, x: m.x, z: m.z, r: m.r });
}

// ---------------------------------------------------------------- 毒雾者

/**
 * 毒雾者死了：平常留下一团毒雾（只伤玩家）。被烧死 / 炸死时毒气爆燃：一圈只伤僵尸的爆炸，地上留一小片火。
 * 爆燃点着旁边的毒雾者会连锁（blast 内部的击杀又会走到这里）
 */
export function gasBurst(g: Game, z: Zombie, ignite: boolean): void {
  const gas = z.def.gas;
  if (!gas) return;
  if (ignite) {
    g.events.emit('gas', { x: z.x, z: z.z, radius: gas.ignite.r, ignite: true });
    blast(g, z.x, z.z, gas.ignite.r, gas.ignite.damage, false);
    g.hz.hazards.push({ kind: 'fire', x: z.x, z: z.z, r: gas.ignite.r * 0.4, life: 3 });
    return;
  }
  g.hz.hazards.push({ kind: 'gas', x: z.x, z: z.z, r: gas.cloud, life: gas.life });
  g.events.emit('gas', { x: z.x, z: z.z, radius: gas.cloud, ignite: false });
}

/** 毒雾被点着时爆燃的伤害（只伤僵尸） */
export const GAS_FLARE = 110;

/** 爆炸 / 地面火碰到毒雾：整团爆燃，变成一小片火 */
function igniteGas(g: Game, x: number, z: number, r: number): void {
  const list = g.hz.hazards;
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i] as Hazard;
    if (h.kind !== 'gas' || Math.hypot(h.x - x, h.z - z) > h.r + r) continue;
    list.splice(i, 1);
    g.events.emit('gas', { x: h.x, z: h.z, radius: h.r * 1.2, ignite: true });
    blast(g, h.x, h.z, h.r * 1.2, GAS_FLARE, false);
    list.push({ kind: 'fire', x: h.x, z: h.z, r: h.r * 0.5, life: 3 });
    i = Math.min(i, list.length);
  }
}

// ---------------------------------------------------------------- 每帧

export function updateHazards(g: Game, dt: number): void {
  const h = g.hz;
  h.shoveCd = Math.max(0, h.shoveCd - dt);
  h.throwCd = Math.max(0, h.throwCd - dt);
  if (h.throwT > 0) {
    h.throwT -= dt;
    if (h.throwT <= 0) {
      h.throwT = 0;
      releaseGrenade(g);
    }
  }
  h.pulseCd = Math.max(0, h.pulseCd - dt);
  if (h.pulseCharge > 0) {
    h.pulseCharge -= dt;
    if (h.pulseCharge <= 0) {
      h.pulseCharge = 0;
      firePulse(g);
    }
  }

  if (h.dazeT > 0) h.dazeT = Math.max(0, h.dazeT - dt);
  // 首领抛出来的碎石 / 酸弹：预警圈倒计时到了就落下
  for (let i = h.marks.length - 1; i >= 0; i--) {
    const m = h.marks[i] as Mark;
    m.t -= dt;
    if (m.t > 0) continue;
    h.marks.splice(i, 1);
    landMark(g, m);
  }

  // 被连锁标记的爆炸物在这里引爆
  for (const e of h.explosives) if (e.alive && e.hp <= 0.5 && e.hp > 0) detonate(g, e);

  // 酸团
  for (let i = h.spits.length - 1; i >= 0; i--) {
    const s = h.spits[i] as Spit;
    s.x += s.vx * dt;
    s.y += s.vy * dt - 0.5 * GRAVITY * dt * dt;
    s.z += s.vz * dt;
    s.vy -= GRAVITY * dt;
    const blocked = g.grid.isBlocked(g.grid.cellX(s.x), g.grid.cellY(s.z)) && s.y < 1.2;
    if (s.y <= 0 || blocked) {
      h.spits.splice(i, 1);
      landSpit(g, s);
    }
  }

  // 手雷：碰墙反弹，引信到了就炸
  for (let i = h.thrown.length - 1; i >= 0; i--) {
    const t = h.thrown[i] as Thrown;
    t.fuse -= dt;
    const nx = t.x + t.vx * dt;
    const nz = t.z + t.vz * dt;
    if (g.grid.isBlocked(g.grid.cellX(nx), g.grid.cellY(t.z))) t.vx *= -0.4;
    else t.x = nx;
    if (g.grid.isBlocked(g.grid.cellX(t.x), g.grid.cellY(nz))) t.vz *= -0.4;
    else t.z = nz;
    t.y += t.vy * dt - 0.5 * GRAVITY * dt * dt;
    t.vy -= GRAVITY * dt;
    if (t.y <= 0.08) {
      t.y = 0.08;
      t.vy = Math.abs(t.vy) * 0.3;
      t.vx *= 0.6;
      t.vz *= 0.6;
    }
    if (t.fuse > 0) continue;
    h.thrown.splice(i, 1);
    if (t.fire) {
      blast(g, t.x, t.z, GRENADE.fire.radius, GRENADE.fire.damage, false, 'grenade');
      h.hazards.push({ kind: 'fire', x: t.x, z: t.z, r: GRENADE.fire.radius * 0.8, life: GRENADE.fire.burn });
    } else blast(g, t.x, t.z, GRENADE.frag.radius, GRENADE.frag.damage, false, 'grenade');
  }

  // 地面危险区：站在里面的僵尸持续受伤；玩家踩酸池 / 火 / 毒雾也会受伤。火碰到毒雾就把它点着
  const p = g.player;
  if (h.hazards.some((k) => k.kind === 'gas')) for (const f of h.hazards.filter((k) => k.kind === 'fire')) igniteGas(g, f.x, f.z, f.r * 0.5);
  for (let i = h.hazards.length - 1; i >= 0; i--) {
    // 毒雾者被火烧死时（下面的 damageZombie）会往列表里加 / 删东西，索引可能越界
    const hz = h.hazards[i];
    if (!hz) continue;
    hz.life -= dt;
    if (hz.life <= 0) {
      h.hazards.splice(i, 1);
      continue;
    }
    const dps = hz.kind === 'fire' ? FIRE_DPS : hz.kind === 'gas' ? GAS_DPS : ACID_DPS;
    if (hz.kind === 'fire') {
      for (const z of g.zombies) if (z.alive && Math.hypot(z.x - hz.x, z.z - hz.z) < hz.r + z.radius) g.damageZombie(z, dps * dt, { silent: true, src: 'fire' });
    }
    if (p.alive && Math.hypot(p.x - hz.x, p.z - hz.z) < hz.r + p.radius) g.damagePlayer(dps * dt * (hz.kind === 'fire' ? 0.6 : 1));
  }
}
