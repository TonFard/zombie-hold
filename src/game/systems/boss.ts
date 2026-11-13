import type { Zombie } from '../entities/zombie';
import { hpScale } from '../data/waves';
import type { ZombieKind } from '../data/zombies';
import { resolveCircleVsGrid } from '../world/collision';
import { HALF_H, HALF_W } from '../world/grid';
import type { Game } from '../sim';

/**
 * 首领技能（每张地图一个首领）：钩子、横扫、抛射、孵化、尖啸、召唤。
 * 蓄力的技能先发 bossSkill windup（地上画预警），蓄满了才结算；蓄力时被眩晕就取消（cancelSkill）。
 */

/** 二阶段：技能冷却 × 这个数 */
export const P2_CD = 0.6;
/** 母巢的卵囊：从背后打身体的伤害倍率 */
export const SAC_MULT = 1.6;
/** 钩中以后拽人的速度（米 / 秒）、最长拽多久 */
const PULL_SPEED = 15;
const PULL_MAX = 0.9;
/** 横扫 / 尖啸 / 咆哮放完以后的收招时间 */
const RECOVER = 0.4;
/** 召唤前咆哮的蓄力 */
export const HOWL_WINDUP = 0.8;

export const SKILL = { none: 0, hook: 1, cleave: 2, shriek: 3, howl: 4 } as const;
export type SkillName = 'hook' | 'cleave' | 'shriek' | 'howl' | 'brood';
const NAMES: Record<number, SkillName> = { 1: 'hook', 2: 'cleave', 3: 'shriek', 4: 'howl' };

const cdK = (z: Zombie): number => (z.rage ? P2_CD : 1);

function emit(g: Game, z: Zombie, skill: SkillName, stage: 'windup' | 'go' | 'hit' | 'end', r = 0, arc = 0): void {
  g.events.emit('bossSkill', { id: z.id, skill, stage, x: z.x, z: z.z, dx: z.skillDX, dz: z.skillDZ, r, arc });
}

/** 每帧：进二阶段、冷却、孵化、放技能。返回 true = 这一帧由技能接管（不走普通的追 / 打） */
export function bossStep(g: Game, z: Zombie, dt: number): boolean {
  const B = z.def.boss!;
  if (!z.rage && z.hp <= z.maxHp * B.phase2) {
    z.rage = true;
    g.events.emit('bossPhase', { zombie: z });
  }
  z.hookCd -= dt;
  z.cleaveCd -= dt;
  z.lobCd -= dt;
  z.shriekCd -= dt;
  z.summonCd -= dt;
  if (B.brood) brood(g, z, dt);
  if (z.skill) return runSkill(g, z, dt);
  if (B.lob) lob(g, z);
  return pickSkill(g, z);
}

/** 蓄力中被眩晕（电击脉冲、推搡）：技能取消，短冷却后再来 */
export function cancelSkill(g: Game, z: Zombie): void {
  if (!z.skill) return;
  const name = NAMES[z.skill] as SkillName;
  z.skill = 0;
  z.skillStage = 0;
  if (name === 'hook') z.hookCd = 2;
  else if (name === 'cleave') z.cleaveCd = 1;
  else if (name === 'shriek') z.shriekCd = 3;
  else z.summonCd = 3;
  emit(g, z, name, 'end');
}

function start(g: Game, z: Zombie, skill: number, t: number, dx: number, dz: number, r = 0, arc = 0): void {
  z.skill = skill;
  z.skillStage = 0;
  z.skillT = t;
  const l = Math.hypot(dx, dz) || 1;
  z.skillDX = dx / l;
  z.skillDZ = dz / l;
  z.yaw = Math.atan2(z.skillDX, z.skillDZ);
  emit(g, z, NAMES[skill] as SkillName, 'windup', r, arc);
}

function pickSkill(g: Game, z: Zombie): boolean {
  const B = z.def.boss!;
  const p = g.player;
  if (!p.alive) return false;
  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const d = Math.hypot(dx, dz);
  const sum = B.summon;
  if (sum && z.summonCd <= 0 && (!sum.p2 || z.rage) && d < 25) {
    start(g, z, SKILL.howl, HOWL_WINDUP, dx, dz);
    return true;
  }
  const cl = B.cleave;
  if (cl && z.cleaveCd <= 0 && d < cl.reach + p.radius) {
    start(g, z, SKILL.cleave, cl.windup, dx, dz, cl.reach, cl.arc);
    return true;
  }
  const hk = B.hook;
  if (hk && z.hookCd <= 0 && d >= hk.min && d <= hk.range && g.grid.segmentClear(z.x, z.z, p.x, p.z, false)) {
    start(g, z, SKILL.hook, hk.windup, dx, dz, hk.range);
    return true;
  }
  const sh = B.shriek;
  if (sh && z.shriekCd <= 0 && d < sh.r * 0.85 && g.grid.segmentClear(z.x, z.z, p.x, p.z, false)) {
    start(g, z, SKILL.shriek, sh.windup, dx, dz, sh.r);
    return true;
  }
  return false;
}

function finish(g: Game, z: Zombie): void {
  const B = z.def.boss!;
  const name = NAMES[z.skill] as SkillName;
  const k = cdK(z);
  if (name === 'hook') z.hookCd = (B.hook?.cd ?? 0) * k;
  else if (name === 'cleave') z.cleaveCd = (B.cleave?.cd ?? 0) * k;
  else if (name === 'shriek') z.shriekCd = (B.shriek?.cd ?? 0) * k;
  else z.summonCd = (B.summon?.cd ?? 0) * k;
  z.skill = 0;
  z.skillStage = 0;
  emit(g, z, name, 'end');
}

function runSkill(g: Game, z: Zombie, dt: number): boolean {
  z.vx = z.vz = 0;
  z.attackTarget = 'none';
  z.hasWp = false;
  z.state = 'move';
  if (z.hitFlash > 0) z.hitFlash -= dt;
  switch (z.skill) {
    case SKILL.hook:
      hook(g, z, dt);
      break;
    case SKILL.cleave:
      cleave(g, z, dt);
      break;
    case SKILL.shriek:
      shriek(g, z, dt);
      break;
    default:
      howl(g, z, dt);
  }
  return true;
}

/** 渲染用：正在放哪一招、蓄力进度（1 = 已经放出去） */
export function skillPose(z: Zombie): { name: 'hook' | 'cleave' | 'shriek' | 'howl' | ''; k: number } {
  const B = z.def.boss;
  if (!B || !z.skill) return { name: '', k: 0 };
  const name = NAMES[z.skill] as 'hook' | 'cleave' | 'shriek' | 'howl';
  if (z.skillStage > 0) return { name, k: 1 };
  const w = name === 'hook' ? B.hook?.windup : name === 'cleave' ? B.cleave?.windup : name === 'shriek' ? B.shriek?.windup : HOWL_WINDUP;
  return { name, k: Math.min(0.999, 1 - z.skillT / (w || 1)) };
}

// ---------------------------------------------------------------- 钩子

/** 蓄力（方向锁死，往旁边闪就躲得开）→ 钩子飞出去 → 钩中就拽到身前，紧接着可以横扫 */
function hook(g: Game, z: Zombie, dt: number): void {
  const hk = z.def.boss!.hook!;
  const p = g.player;
  if (z.skillStage === 0) {
    z.skillT -= dt;
    if (z.skillT > 0) return;
    z.skillStage = 1;
    z.skillT = 0;
    emit(g, z, 'hook', 'go', hk.range);
    return;
  }
  if (z.skillStage === 1) {
    const from = z.skillT;
    z.skillT = Math.min(hk.range, z.skillT + hk.speed * dt);
    const tx = z.x + z.skillDX * z.skillT;
    const tz = z.z + z.skillDZ * z.skillT;
    // 这一帧钩尖扫过的一段离玩家多近
    const rx = p.x - z.x;
    const rz = p.z - z.z;
    const along = rx * z.skillDX + rz * z.skillDZ;
    const side = Math.abs(rx * z.skillDZ - rz * z.skillDX);
    if (p.alive && along >= from - 0.5 && along <= z.skillT + 0.3 && side < hk.width + p.radius) {
      g.damagePlayer(hk.damage * g.config.zombieDamage);
      z.skillStage = 2;
      z.skillT = PULL_MAX;
      z.everAttacked = true;
      emit(g, z, 'hook', 'hit', hk.range);
      return;
    }
    if (z.skillT >= hk.range || g.grid.isBlocked(g.grid.cellX(tx), g.grid.cellY(tz))) finish(g, z);
    return;
  }
  // 拽：玩家朝首领身前滑过去，墙照样挡
  z.skillT -= dt;
  const dx = z.x - p.x;
  const dz = z.z - p.z;
  const d = Math.hypot(dx, dz);
  const stop = z.radius + p.radius + 0.8;
  if (p.alive && d > stop && z.skillT > 0) {
    const step = Math.min(d - stop, PULL_SPEED * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    p.vx = p.vz = 0;
    resolveCircleVsGrid(g.grid, p, p.radius, true);
    return;
  }
  finish(g, z);
  // 拽到身前：横扫马上就能用
  z.cleaveCd = 0;
}

// ---------------------------------------------------------------- 横扫

/** 蓄力时朝向锁死，往两边或往后退出扇形就躲得开；扫中的建筑吃双倍 */
function cleave(g: Game, z: Zombie, dt: number): void {
  const cl = z.def.boss!.cleave!;
  const p = g.player;
  z.skillT -= dt;
  if (z.skillStage === 1) {
    if (z.skillT <= 0) finish(g, z);
    return;
  }
  if (z.skillT > 0) return;
  z.skillStage = 1;
  z.skillT = RECOVER;
  emit(g, z, 'cleave', 'go', cl.reach, cl.arc);
  const inArc = (x: number, zz: number, pad: number): boolean => {
    const dx = x - z.x;
    const dz = zz - z.z;
    const d = Math.hypot(dx, dz);
    if (d > cl.reach + pad) return false;
    return d < z.radius || (dx * z.skillDX + dz * z.skillDZ) / d > Math.cos(cl.arc);
  };
  if (p.alive && inArc(p.x, p.z, p.radius)) {
    g.damagePlayer(cl.damage * g.config.zombieDamage);
    const d = Math.hypot(p.x - z.x, p.z - z.z) || 1;
    p.vx += ((p.x - z.x) / d) * 6;
    p.vz += ((p.z - z.z) / d) * 6;
    z.everAttacked = true;
    emit(g, z, 'cleave', 'hit', cl.reach, cl.arc);
  }
  for (const s of [...g.structures.values()]) {
    if (inArc(s.cx - HALF_W + 0.5, s.cy - HALF_H + 0.5, 0.5)) g.damageStructure(s.id, cl.damage * 2);
  }
}

// ---------------------------------------------------------------- 尖啸

/** 蓄力（仰头）→ 尖啸：看得见的玩家受伤、被震住（减速、晃屏）；身边的僵尸加速。躲到墙后面就没事 */
function shriek(g: Game, z: Zombie, dt: number): void {
  const sh = z.def.boss!.shriek!;
  const p = g.player;
  z.skillT -= dt;
  if (z.skillStage === 1) {
    if (z.skillT <= 0) finish(g, z);
    return;
  }
  if (z.skillT > 0) return;
  z.skillStage = 1;
  z.skillT = RECOVER;
  emit(g, z, 'shriek', 'go', sh.r);
  g.events.emit('scream', { x: z.x, z: z.z, radius: sh.r });
  if (p.alive && Math.hypot(p.x - z.x, p.z - z.z) < sh.r && g.grid.segmentClear(z.x, z.z, p.x, p.z, false)) {
    g.damagePlayer(sh.damage * g.config.zombieDamage);
    g.hz.dazeT = Math.max(g.hz.dazeT, sh.daze);
    emit(g, z, 'shriek', 'hit', sh.r);
  }
  for (const o of g.zombies) {
    if (!o.alive || o === z || Math.hypot(o.x - z.x, o.z - z.z) > sh.r) continue;
    o.hasteT = 5;
    o.hasteK = 0.4;
  }
}

// ---------------------------------------------------------------- 召唤 / 孵化

/** 在 (x, z) 周围放 n 只小怪（生命跟着这一夜走，零件只给四分之一） */
function spawnMinions(g: Game, kind: ZombieKind, n: number, x: number, z: number, yaw: number): number {
  const hp = hpScale(g.run.night) * g.config.zombieHp;
  let made = 0;
  for (let i = 0; i < n; i++) {
    const a = yaw + (i / n) * Math.PI * 2 + 0.4;
    const r = 1.4 + (i % 2) * 0.8;
    const sx = x + Math.sin(a) * r;
    const sz = z + Math.cos(a) * r;
    if (g.grid.isBlocked(g.grid.cellX(sx), g.grid.cellY(sz))) continue;
    const c = g.spawnZombie(kind, sx, sz, hp);
    if (!c) break;
    c.minion = true;
    c.yaw = a;
    c.goal = 'player';
    c.stunT = 0.4;
    made++;
  }
  return made;
}

function howl(g: Game, z: Zombie, dt: number): void {
  const sum = z.def.boss!.summon!;
  z.skillT -= dt;
  if (z.skillStage === 1) {
    if (z.skillT <= 0) finish(g, z);
    return;
  }
  if (z.skillT > 0) return;
  z.skillStage = 1;
  z.skillT = RECOVER;
  spawnMinions(g, sum.kind, sum.count, z.x, z.z, z.yaw);
  emit(g, z, 'howl', 'go', 3);
}

/** 母巢：每隔一阵从背上的卵囊里孵出几只（剩几个囊孵几只，最多 3 只）；卵囊全打爆就不孵了 */
function brood(g: Game, z: Zombie, dt: number): void {
  const br = z.def.boss!.brood!;
  if (z.sacs <= 0) return;
  z.broodT -= dt / cdK(z);
  if (z.broodT > 0) return;
  z.broodT = br.every;
  const bx = z.x - Math.sin(z.yaw) * (z.radius + 0.4);
  const bz = z.z - Math.cos(z.yaw) * (z.radius + 0.4);
  const n = spawnMinions(g, br.kind, Math.min(3, z.sacs), bx, bz, z.yaw + Math.PI);
  if (n > 0) {
    z.skillDX = -Math.sin(z.yaw);
    z.skillDZ = -Math.cos(z.yaw);
    emit(g, z, 'brood', 'go', 2);
  }
}

/** 打在卵囊上（从背后打身体）：累计到一个囊的血量就打爆一个，爆开时溅一圈酸 */
export function hitSac(g: Game, z: Zombie, dmg: number): void {
  const br = z.def.boss?.brood;
  if (!br || z.sacs <= 0) return;
  z.sacDmg += dmg;
  if (z.sacDmg < br.sacHp * z.maxHp) return;
  z.sacDmg = 0;
  z.sacs--;
  const bx = z.x - Math.sin(z.yaw) * z.radius;
  const bz = z.z - Math.cos(z.yaw) * z.radius;
  g.hz.hazards.push({ kind: 'acid', x: bx, z: bz, r: 1.2, life: 3 });
  g.events.emit('bossSac', { zombie: z, x: bx, z: bz, left: z.sacs });
}

// ---------------------------------------------------------------- 抛射

/** 碎石 / 酸弹：玩家在射程内（又不在脚边）就往他身上和身边扔几个，落点先画预警圈。二阶段多扔两个 */
function lob(g: Game, z: Zombie): void {
  const L = z.def.boss!.lob!;
  const p = g.player;
  if (z.lobCd > 0 || (L.p2 && !z.rage) || !p.alive) return;
  const d = Math.hypot(p.x - z.x, p.z - z.z);
  if (d > L.range || d < 4) return;
  z.lobCd = L.cd * cdK(z);
  const n = L.count + (z.rage && !L.p2 ? 2 : 0);
  // 第一个砸在玩家 0.8 秒后的位置，其余的围着散开
  const lead = 0.8;
  const cx = p.x + p.vx * lead;
  const cz = p.z + p.vz * lead;
  for (let i = 0; i < n; i++) {
    const a = g.rng.range(0, Math.PI * 2);
    const r = i === 0 ? 0 : g.rng.range(L.spread * 0.5, L.spread * 1.3);
    const x = cx + Math.sin(a) * r;
    const zz = cz + Math.cos(a) * r;
    if (g.grid.isBlocked(g.grid.cellX(x), g.grid.cellY(zz))) continue;
    g.hz.marks.push({ kind: L.kind, x, z: zz, r: L.r, t: L.delay + i * 0.12, damage: L.damage });
  }
  z.skillDX = (p.x - z.x) / (d || 1);
  z.skillDZ = (p.z - z.z) / (d || 1);
  g.events.emit('bossLob', { id: z.id, kind: L.kind, x: z.x, z: z.z });
}
