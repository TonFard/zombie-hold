import type { CombatApi, GameCtx, Hit } from './api';

/**
 * 玩家的子弹、近战、手雷打到谁：把丧尸（horde）和带枪的人（raiders）合成一个入口。
 * 武器模块只认这个，不用知道场上有几种东西。
 */
export class Combat implements CombatApi {
  private readonly hit: Hit = { id: 0, dist: 0, head: false, x: 0, y: 0, z: 0, who: 'zombie' };

  constructor(private readonly ctx: GameCtx) {}

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): Hit | null {
    const z = this.ctx.horde.raycast(ox, oy, oz, dx, dy, dz, maxDist);
    // 人要比丧尸近才算
    const h = this.ctx.raiders.raycast(ox, oy, oz, dx, dy, dz, z ? z.dist : maxDist);
    const best = h ?? z;
    if (!best) return null;
    const out = this.hit;
    out.id = best.id;
    out.dist = best.dist;
    out.head = best.head;
    out.x = best.x;
    out.y = best.y;
    out.z = best.z;
    out.who = h ? 'human' : 'zombie';
    return out;
  }

  damage(hit: Hit, amount: number, dx: number, dz: number): boolean {
    return hit.who === 'human' ? this.ctx.raiders.damage(hit.id, amount, hit.head, dx, dz, true) : this.ctx.horde.damage(hit.id, amount, hit.head, dx, dz, true);
  }

  melee(x: number, z: number, yaw: number, reach: number, arc: number, amount: number): number {
    return this.ctx.horde.melee(x, z, yaw, reach, arc, amount) + this.ctx.raiders.melee(x, z, yaw, reach, arc, amount);
  }

  blast(x: number, y: number, z: number, radius: number, damage: number): number {
    const { ctx } = this;
    const n = ctx.horde.blast(x, y, z, radius, damage, true) + ctx.raiders.blast(x, y, z, radius, damage, true);
    // 玩家自己：离得太近照样挨炸（隔着墙不算；坐在车里减半）
    const p = ctx.player;
    const py = p.feet + 0.9;
    const d = Math.hypot(p.x - x, py - y, p.z - z);
    if (d < radius && !ctx.survival.dead) {
      const L = Math.max(d, 1e-3);
      const clear = d < 0.6 || ctx.world.raycast(x, y + 0.2, z, (p.x - x) / L, (py - y - 0.2) / L, (p.z - z) / L, L - 0.4, false) === Infinity;
      if (clear) {
        const k = 1 - d / radius;
        ctx.survival.hurt(damage * k * k * (ctx.garage.driving ? 0.5 : 1), x, z, '被炸死');
      }
    }
    return n;
  }

  noise(x: number, z: number, radius: number): void {
    this.ctx.horde.noise(x, z, radius);
    this.ctx.raiders.noise(x, z, radius);
  }
}
