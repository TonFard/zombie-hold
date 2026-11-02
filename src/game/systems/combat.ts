import { clamp, lerp } from '../core/math';
import { statsAt, type WeaponKind, type WeaponStats } from '../data/weapons';
import type { Zombie } from '../entities/zombie';
import type { Projectile } from '../entities/projectile';
import type { Game } from '../sim';

const DEG = Math.PI / 180;

interface Hit {
  z: Zombie;
  t: number;
}
const hits: Hit[] = [];

/** 霰弹随距离衰减：射程一半以内满伤害，到射程尽头剩 55% */
function falloff(kind: WeaponKind, t: number, range: number): number {
  if (kind !== 'shotgun') return 1;
  const k = t / range;
  return k <= 0.5 ? 1 : lerp(1, 0.55, (k - 0.5) / 0.5);
}

/** 击退速度：伤害越高推得越远，体型越大越推不动 */
function knockback(damage: number, z: Zombie): number {
  const mass = (z.radius / 0.32) ** 2;
  return Math.min(4, damage * 0.05) / mass;
}

function hitscan(g: Game, st: WeaponStats, kind: WeaponKind, ox: number, oz: number, ang: number): void {
  const dx = Math.sin(ang);
  const dz = Math.cos(ang);
  const wallT = g.grid.rayDist(ox, oz, dx, dz, st.range);

  hits.length = 0;
  for (const z of g.zombies) {
    if (!z.alive) continue;
    const rx = z.x - ox;
    const rz = z.z - oz;
    const t = rx * dx + rz * dz;
    if (t < -z.radius || t > wallT + z.radius) continue;
    const d2 = rx * rx + rz * rz - t * t;
    const r = z.radius;
    if (d2 > r * r) continue;
    const tin = Math.max(0, t - Math.sqrt(r * r - d2));
    if (tin > wallT) continue;
    hits.push({ z, t: tin });
  }
  hits.sort((a, b) => a.t - b.t);

  const maxHits = st.pierce + 1;
  const n = Math.min(hits.length, maxHits);
  for (let i = 0; i < n; i++) {
    const h = hits[i] as Hit;
    const dmg = st.damage * g.mods.damage * falloff(kind, h.t, st.range);
    const crit = g.mods.crit > 0 && g.rng.next() < g.mods.crit;
    const kb = knockback(dmg, h.z);
    g.damageZombie(h.z, crit ? dmg * 2 : dmg, { crit, kx: dx * kb, kz: dz * kb, burn: st.burn });
    g.events.emit('impact', { x: ox + dx * h.t, z: oz + dz * h.t, nx: -dx, nz: -dz, flesh: true, kind });
  }
  // 穿透次数用完就停在最后一个目标；否则飞到墙或射程尽头
  const stopped = hits.length >= maxHits;
  const endT = stopped ? (hits[maxHits - 1] as Hit).t : wallT;
  if (!stopped && wallT < st.range) {
    g.events.emit('impact', { x: ox + dx * wallT, z: oz + dz * wallT, nx: -dx, nz: -dz, flesh: false, kind });
  }
  g.events.emit('tracer', { kind, x0: ox, z0: oz, x1: ox + dx * endT, z1: oz + dz * endT, hitFlesh: n > 0 });
}

function launch(g: Game, st: WeaponStats, ox: number, oz: number, ang: number): void {
  const p: Projectile = {
    x: ox,
    z: oz,
    vx: Math.sin(ang) * st.speed,
    vz: Math.cos(ang) * st.speed,
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
  const slot = g.loadout[kind];
  slot.mag--;
  p.recoil = 1;

  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  let ox = p.x + sy * 0.6;
  let oz = p.z + cy * 0.6;
  if (g.grid.isBlocked(g.grid.cellX(ox), g.grid.cellY(oz))) {
    ox = p.x;
    oz = p.z;
  }
  g.events.emit('shot', { kind, mx: ox, mz: oz, yaw: p.yaw });

  if (st.speed > 0) {
    launch(g, st, ox, oz, p.yaw + (g.rng.next() + g.rng.next() - 1) * st.spread * DEG);
    return;
  }
  for (let i = 0; i < st.pellets; i++) {
    // 两个均匀随机数相加：偏向中心的散布
    const ang = p.yaw + (g.rng.next() + g.rng.next() - 1) * st.spread * DEG;
    hitscan(g, st, kind, ox, oz, ang);
  }
}

export function explode(g: Game, x: number, z: number, aoe: number, damage: number, direct: Zombie | null, split: number, bomblet: boolean): void {
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
  if (split > 0 && !bomblet) {
    for (let i = 0; i < split; i++) {
      const a = (i / split) * Math.PI * 2 + g.rng.range(-0.4, 0.4);
      const sp = g.rng.range(5, 8);
      g.projectiles.push({
        x,
        z,
        vx: Math.cos(a) * sp,
        vz: Math.sin(a) * sp,
        life: g.rng.range(0.22, 0.4),
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
    const nx = p.x + p.vx * dt;
    const nz = p.z + p.vz * dt;
    let boom = p.life <= 0;
    let direct: Zombie | null = null;
    if (!boom && g.grid.isBlocked(g.grid.cellX(nx), g.grid.cellY(nz))) boom = true;
    if (!boom) {
      for (const z of g.zombies) {
        if (z.alive && Math.hypot(z.x - nx, z.z - nz) < z.radius + 0.18) {
          direct = z;
          boom = true;
          break;
        }
      }
    }
    if (boom) {
      ps.splice(i, 1);
      explode(g, direct ? nx : p.x, direct ? nz : p.z, p.aoe, p.damage, direct, p.split, p.bomblet);
    } else {
      p.x = nx;
      p.z = nz;
    }
  }
}

/** 灼烧：每帧结算持续伤害（不弹伤害数字，避免刷屏） */
export function updateStatus(g: Game, dt: number): void {
  for (const z of g.zombies) {
    if (!z.alive || z.burnT <= 0) continue;
    z.burnT -= dt;
    g.damageZombie(z, z.burnDps * dt, { silent: true, burn: 0 });
  }
}
