import { clamp, lerp } from '../core/math';
import { BARRICADE_HEIGHT, BULLET_GRAVITY, MUZZLE_OFFSET, TURRET_HEIGHT, WALL_HEIGHT, zeroPitch } from '../data/ballistics';
import { isTurret } from '../data/structures';
import { WEAPONS, falloffAt, statsAt, type WeaponStats } from '../data/weapons';
import type { Bullet } from '../entities/bullet';
import type { Projectile } from '../entities/projectile';
import type { Zombie } from '../entities/zombie';
import type { Game } from '../sim';
import { damageExplosive, explosiveAt } from './hazards';
import { segmentVsZombie } from './hitvolume';

const DEG = Math.PI / 180;
/** 榴弹的重力（米/秒²）。比子弹用的小得多：榴弹慢，要有明显的抛物线 */
const GRENADE_GRAVITY = 9.8;


/** 击退速度：伤害越高推得越远，体型越大越推不动 */
function knockback(damage: number, z: Zombie): number {
  const mass = (z.radius / 0.32) ** 2;
  return Math.min(4, damage * 0.05) / mass;
}

// ---------------------------------------------------------------- 障碍

interface Stop {
  /** 线段上的比例 0–1 */
  t: number;
  zone: 'wall' | 'ground';
}

/**
 * 线段 (x0,y0,z0)→(+dx,+dy,+dz) 上第一个挡住子弹的东西：地面，或比子弹当时高度更高的障碍 / 建筑。
 * 障碍高度来自地图（围墙 2.4–3 米、车 1.35、木箱 0.9……）；路障 1.15；炮塔 1.4。
 * 所以眼睛（1.62 米）平着打能越过木箱和路障，压低枪口就会打在上面；细障碍（树干、灯杆、油桶）按圆柱算。
 */
export function obstruction(g: Game, x0: number, y0: number, z0: number, dx: number, dy: number, dz: number): Stop | null {
  let best: Stop | null = null;
  if (y0 + dy <= 0) best = { t: y0 <= 0 ? 0 : y0 / -dy, zone: 'ground' };
  const limit = best ? best.t : 1;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
  const grid = g.grid;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (t > limit) break;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const z = z0 + dz * t;
    const cx = grid.cellX(x);
    const cy = grid.cellY(z);
    if (!grid.inBounds(cx, cy)) return { t, zone: 'wall' };
    const idx = grid.idx(cx, cy);
    let h = 0;
    if (grid.solid[idx]) {
      h = (grid.height[idx] as number) || WALL_HEIGHT;
      const post = grid.post[idx] as number;
      // 细障碍：只有真的打在柱子上才算
      if (post > 0 && Math.hypot(x - grid.centerX(cx), z - grid.centerZ(cy)) > post) h = 0;
    } else {
      const sid = grid.structure[idx] as number;
      if (sid >= 0) h = isTurret(g.structures.get(sid)?.kind ?? 'barricade') ? TURRET_HEIGHT : BARRICADE_HEIGHT;
    }
    if (h > 0 && y < h) return { t, zone: 'wall' };
  }
  return best;
}

// ---------------------------------------------------------------- 开火


function launchGrenade(g: Game, st: WeaponStats, ox: number, oy: number, oz: number, yaw: number, pitch: number): void {
  const cp = Math.cos(pitch);
  const p: Projectile = {
    x: ox,
    y: oy,
    z: oz,
    vx: Math.sin(yaw) * cp * st.speed,
    vy: Math.sin(pitch) * st.speed,
    vz: Math.cos(yaw) * cp * st.speed,
    life: st.range / st.speed,
    damage: st.damage * g.mods.damage,
    aoe: st.aoe,
    split: st.split,
    bomblet: false,
  };
  g.projectiles.push(p);
}

export function fireWeapon(g: Game): void {
  const p = g.player;
  const kind = p.weapon;
  const st = statsAt(kind, p.tier);
  const def = WEAPONS[kind];
  const slot = g.loadout[kind];
  slot.mag--;
  p.recoil = 1;

  // 视线 = 鼠标视角 + 后坐力抬起的量（先算这一发，再累加后坐力，第一发总是打在准星上）
  const pitch = g.input.aimPitch + p.kickPitch;
  const aimYaw = p.yaw + p.kickYaw;
  const rk = (1 - 0.5 * p.ads) * (1 - 0.25 * p.crouch);
  p.kickPitch = Math.min(0.2, p.kickPitch + def.recoil.v * DEG * rk);
  p.kickYaw += (g.rng.next() * 2 - 1) * def.recoil.h * DEG * rk;
  p.kickYaw = clamp(p.kickYaw, -0.06, 0.06);
  const sy = Math.sin(aimYaw);
  const cy = Math.cos(aimYaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  let ox = p.x + sy * cp * MUZZLE_OFFSET;
  let oy = p.eye + sp * MUZZLE_OFFSET;
  let oz = p.z + cy * cp * MUZZLE_OFFSET;
  // 枪口前方就是墙 / 路障时，从眼睛出膛，免得子弹一出来就卡在里面
  if (g.grid.isBlocked(g.grid.cellX(ox), g.grid.cellY(oz))) {
    ox = p.x;
    oy = p.eye;
    oz = p.z;
  }
  g.events.emit('shot', { kind, mx: ox, mz: oz, yaw: p.yaw });

  // 瞄准越充分，散布越小；蹲下再小 20%，滑铲 / 移动时腰射更散
  const moveK = Math.min(1, Math.hypot(p.vx, p.vz) / 3.4);
  const hip = 1 + 0.35 * moveK * (1 - p.ads) + (p.slide > 0 ? 0.6 : 0);
  const spread = st.spread * hip * lerp(1, def.ads.spread * g.mods.adsSpread, p.ads) * (1 - 0.2 * p.crouch) * DEG;
  // 两个均匀随机数相加：偏向中心的散布
  const jitter = () => (g.rng.next() + g.rng.next() - 1) * spread;

  if (st.speed > 0) {
    launchGrenade(g, st, ox, oy, oz, aimYaw + jitter(), pitch + jitter());
    return;
  }
  const lift = zeroPitch(kind);
  for (let i = 0; i < st.pellets; i++) {
    const yaw = aimYaw + jitter();
    const pit = pitch + lift + jitter();
    const c = Math.cos(pit);
    const b: Bullet = {
      id: g.nextBulletId++,
      kind,
      x: ox,
      y: oy,
      z: oz,
      vx: Math.sin(yaw) * c * def.muzzle,
      vy: Math.sin(pit) * def.muzzle,
      vz: Math.cos(yaw) * c * def.muzzle,
      damage: st.damage * g.mods.damage,
      pierceLeft: st.pierce,
      traveled: 0,
      range: st.range,
      burn: st.burn,
      slowHit: st.slowHit,
      refund: st.refund,
      hit: [],
    };
    g.bullets.push(b);
  }
}

// ---------------------------------------------------------------- 子弹飞行

interface Cand {
  z: Zombie;
  t: number;
  head: boolean;
  core: boolean;
}
const cands: Cand[] = [];

export function updateBullets(g: Game, dt: number): void {
  const bs = g.bullets;
  for (let i = bs.length - 1; i >= 0; i--) {
    const b = bs[i] as Bullet;
    // 这一帧的位移：匀加速（重力）的精确解，不是欧拉积分，所以下坠量和解析公式一致
    const dx = b.vx * dt;
    const dy = b.vy * dt - 0.5 * BULLET_GRAVITY * dt * dt;
    const dz = b.vz * dt;
    const len = Math.hypot(dx, dy, dz);
    const hLen = Math.hypot(b.vx, b.vz) || 1;
    const ux = b.vx / hLen;
    const uz = b.vz / hLen;

    let stopT = 1;
    let ob = obstruction(g, b.x, b.y, b.z, dx, dy, dz);
    if (ob) stopT = ob.t;
    let expired = false;
    if (b.traveled + len >= b.range) {
      const tr = (b.range - b.traveled) / len;
      if (tr < stopT) {
        stopT = Math.max(0, tr);
        ob = null;
        expired = true;
      }
    }

    // 候选命中：在被挡住之前，线段碰到的所有僵尸，按先后排序
    cands.length = 0;
    for (const z of g.zombies) {
      if (!z.alive || b.hit.includes(z.id)) continue;
      const h = segmentVsZombie(z, b.x, b.y, b.z, dx, dy, dz);
      if (h && h.t <= stopT) cands.push({ z, t: h.t, head: h.head, core: !!h.core });
    }
    cands.sort((a, c) => a.t - c.t);

    // 爆头的额外部分（倍率 − 1）吃卡牌加成和僵尸的头部脆弱系数
    const headBonus = (WEAPONS[b.kind].headMult - 1) * g.mods.head;
    for (const c of cands) {
      let dmg = b.damage * falloffAt(b.kind, b.traveled + len * c.t, b.range);
      if (c.head) dmg *= 1 + headBonus * c.z.def.headVuln;
      // 首领弱点：硬直时打胸口的核心，按弱点倍率（替代爆头）
      if (c.core && c.z.def.charge) dmg *= c.z.def.charge.core.mult;
      // 吐酸者：打破酸囊一枪毙命
      if (c.head && c.z.def.headInstakill) dmg = Math.max(dmg, c.z.hp + 1);
      const crit = g.mods.crit > 0 && g.rng.next() < g.mods.crit;
      if (crit) dmg *= 2;
      // 卡牌「战意」：连杀越高伤害越高；「近身狂暴」：3 米内伤害更高
      if (g.mods.comboDamage > 0 && g.combo > 0 && g.comboT > 0) dmg *= 1 + g.mods.comboDamage * Math.min(10, g.combo);
      if (g.mods.closeDamage !== 1 && Math.hypot(c.z.x - g.player.x, c.z.z - g.player.z) < 3 + c.z.radius) dmg *= g.mods.closeDamage;
      const kb = knockback(dmg, c.z);
      const killed = g.damageZombie(c.z, dmg, { crit, head: c.head, kx: ux * kb, kz: uz * kb, burn: b.burn });
      if (b.slowHit > 0 && !killed) {
        c.z.slowT = 1.2;
        c.z.slowK = b.slowHit;
      }
      // 狙击招牌：爆头击杀返还子弹
      // 卡牌「弹匣回收」：所有武器爆头击杀都返还子弹
      const refund = b.refund + (killed && c.head ? g.mods.headRefund : 0);
      if (killed && c.head && refund > 0) {
        const slot = g.loadout[b.kind];
        slot.mag = Math.min(statsAt(b.kind, slot.tier).mag, slot.mag + refund);
        g.events.emit('refund', { kind: b.kind, amount: refund });
      }
      g.events.emit('impact', {
        x: b.x + dx * c.t,
        y: b.y + dy * c.t,
        z: b.z + dz * c.t,
        nx: -ux,
        nz: -uz,
        flesh: true,
        zone: c.head ? 'head' : 'body',
        kind: b.kind,
      });
      b.hit.push(c.z.id);
      if (b.pierceLeft <= 0) {
        stopT = c.t;
        ob = null;
        expired = true; // 被打中的最后一个目标吃掉了，不产生墙面火花
        break;
      }
      b.pierceLeft--;
    }

    if (ob && ob.t <= stopT) {
      // 打在爆炸物上：扣它的生命（油桶几枪就炸）
      if (g.config.extras && ob.zone === 'wall') {
        const hx = b.x + dx * ob.t;
        const hz = b.z + dz * ob.t;
        const e = explosiveAt(g, g.grid.cellX(hx), g.grid.cellY(hz));
        if (e) damageExplosive(g, e, b.damage);
      }
      g.events.emit('impact', {
        x: b.x + dx * ob.t,
        y: Math.max(0, b.y + dy * ob.t),
        z: b.z + dz * ob.t,
        nx: -ux,
        nz: -uz,
        flesh: false,
        zone: ob.zone,
        kind: b.kind,
      });
      expired = true;
    }

    if (expired) {
      bs.splice(i, 1);
      continue;
    }
    b.x += dx;
    b.y += dy;
    b.z += dz;
    b.vy -= BULLET_GRAVITY * dt;
    b.traveled += len;
  }
}

// ---------------------------------------------------------------- 爆炸与榴弹

export function explode(g: Game, x: number, z: number, aoe: number, damage: number, direct: Zombie | null, split: number, bomblet: boolean, y = 0.4): void {
  for (const zb of g.zombies) {
    if (!zb.alive) continue;
    const dx = zb.x - x;
    const dz = zb.z - z;
    const d = Math.hypot(dx, dz) - zb.radius;
    if (d > aoe) continue;
    const f = zb === direct ? 1 : lerp(1, 0.4, clamp(d / aoe, 0, 1));
    const len = Math.hypot(dx, dz) || 1;
    const kb = knockback(damage, zb) * 2.2 * (1 - clamp(d / aoe, 0, 1) * 0.6);
    g.damageZombie(zb, damage * f, { kx: (dx / len) * kb, kz: (dz / len) * kb });
  }
  g.events.emit('explosion', { x, z, radius: aoe, big: !bomblet });
  // 榴弹 / 迫击炮也能引爆附近的爆炸物
  if (g.config.extras) for (const e of g.hz.explosives) if (e.alive && Math.hypot(e.x - x, e.z - z) < aoe + 0.8) damageExplosive(g, e, damage);
  if (split > 0 && !bomblet) {
    for (let i = 0; i < split; i++) {
      const a = (i / split) * Math.PI * 2 + g.rng.range(-0.4, 0.4);
      const sp = g.rng.range(4, 6.5);
      g.projectiles.push({
        x,
        y: Math.max(0.3, y),
        z,
        vx: Math.cos(a) * sp,
        vy: g.rng.range(2.5, 4),
        vz: Math.sin(a) * sp,
        life: g.rng.range(0.45, 0.6),
        damage: damage * 0.28,
        aoe: Math.max(1.2, aoe * 0.55),
        split: 0,
        bomblet: true,
      });
    }
  }
}

export function updateProjectiles(g: Game, dt: number): void {
  const ps = g.projectiles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i] as Projectile;
    p.life -= dt;
    const dx = p.vx * dt;
    const dy = p.vy * dt - 0.5 * GRENADE_GRAVITY * dt * dt;
    const dz = p.vz * dt;
    let boom = p.life <= 0;
    let direct: Zombie | null = null;
    let ex = p.x + dx;
    let ey = p.y + dy;
    let ez = p.z + dz;
    if (!boom) {
      const ob = obstruction(g, p.x, p.y, p.z, dx, dy, dz);
      if (ob) {
        boom = true;
        ex = p.x + dx * ob.t;
        ey = Math.max(0, p.y + dy * ob.t);
        ez = p.z + dz * ob.t;
      }
    }
    if (!boom) {
      for (const z of g.zombies) {
        if (z.alive && ey >= 0 && ey <= z.def.height + 0.2 && Math.hypot(z.x - ex, z.z - ez) < z.radius + 0.18) {
          direct = z;
          boom = true;
          break;
        }
      }
    }
    if (boom) {
      ps.splice(i, 1);
      explode(g, ex, ez, p.aoe, p.damage, direct, p.split, p.bomblet, ey);
    } else {
      p.x = ex;
      p.y = ey;
      p.z = ez;
      p.vy -= GRENADE_GRAVITY * dt;
    }
  }
}

/** 灼烧：每帧结算持续伤害（不弹伤害数字，避免刷屏）；减速倒计时 */
export function updateStatus(g: Game, dt: number): void {
  for (const z of g.zombies) {
    if (z.slowT > 0) z.slowT -= dt;
    if (!z.alive || z.burnT <= 0) continue;
    z.burnT -= dt;
    g.damageZombie(z, z.burnDps * dt, { silent: true, burn: 0 });
  }
}

// ---------------------------------------------------------------- 近战

/** 近战（枪托砸 / 刀）：前方 1.6 米、左右 50° 内最近的一个僵尸，伤害固定，击退明显 */
export const MELEE_DAMAGE = 55;
const MELEE_RANGE = 1.6;
const MELEE_ARC = 50 * DEG;

export function melee(g: Game): void {
  const p = g.player;
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  let best: Zombie | null = null;
  let bestD = Infinity;
  for (const z of g.zombies) {
    if (!z.alive) continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    const d = Math.hypot(dx, dz) - z.radius;
    if (d > MELEE_RANGE || d >= bestD) continue;
    const a = Math.acos(clamp((dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1), -1, 1));
    if (a > MELEE_ARC) continue;
    // 中间隔着墙打不到
    if (!g.grid.segmentClear(p.x, p.z, z.x, z.z, false)) continue;
    best = z;
    bestD = d;
  }
  const hx = p.x + fx * 1.0;
  const hz = p.z + fz * 1.0;
  if (!best) {
    g.events.emit('meleeHit', { zombie: null, x: hx, y: p.eye - 0.3, z: hz });
    return;
  }
  const kb = knockback(MELEE_DAMAGE, best) * 2.5;
  g.damageZombie(best, MELEE_DAMAGE * g.mods.damage, { kx: fx * kb, kz: fz * kb });
  g.events.emit('meleeHit', { zombie: best, x: best.x - fx * best.radius, y: Math.min(best.def.height * 0.75, p.eye), z: best.z - fz * best.radius });
}
