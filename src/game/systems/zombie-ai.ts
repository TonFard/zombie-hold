import { angleDiff, clamp } from '../core/math';
import type { Zombie } from '../entities/zombie';
import { INF } from '../nav/flowfield';
import { rectDist, resolveCircleVsGrid } from '../world/collision';
import { GRID_H, GRID_W, HALF_H, HALF_W } from '../world/grid';
import type { Game } from '../sim';
import { FLASHLIGHT } from '../data/modifiers';
import { spitAt } from './hazards';
import { bossStep, cancelSkill } from './boss';

/** 沿路径向前看几格，找最远的看得见的路点（拉直路径） */
const LOOK = 6;
/** 攻击够得着的距离（在体型半径之外） */
const REACH = 0.45;
const SEP_GAIN = 1.8;
/** 走路时和墙保持的距离（米，在体型半径之外）：模型的手臂、肩膀比碰撞圆宽，贴着墙走就插进墙里 */
const WALL_CLEAR = 0.24;
/** 离墙太近时往外推的速度（米 / 秒，贴墙时最大） */
const WALL_GAIN = 1.1;
const chain = new Int32Array(LOOK);

function setWp(z: Zombie, x: number, zz: number): void {
  z.hasWp = true;
  z.wpX = x;
  z.wpZ = zz;
}

/** 决定这一帧的目标：攻击谁，或者往哪走 */
function think(g: Game, z: Zombie): void {
  const { grid, player, core } = g;
  const def = z.def;
  const pdx = player.x - z.x;
  const pdz = player.z - z.z;
  const pd = Math.hypot(pdx, pdz);

  const aggro = def.aggro * g.aggroScale * (g.flashOn ? FLASHLIGHT.aggro : 1);
  if (def.crawl && player.alive && g.aggroScale > 0) {
    // 爬行者：只追人，不打发电机
    z.goal = 'player';
  } else if (player.alive && aggro > 0) {
    if (z.goal === 'core' && pd < aggro) z.goal = 'player';
    else if (z.goal === 'player' && pd > aggro * 1.5) z.goal = 'core';
  } else {
    z.goal = 'core';
  }

  z.attackTarget = 'none';
  z.targetStructure = -1;
  z.hasWp = false;

  const cr = core.rect;
  if (z.goal === 'player') {
    if (pd <= z.radius + player.radius + REACH) {
      z.attackTarget = 'player';
      z.aimX = player.x;
      z.aimZ = player.z;
      return;
    }
  } else if (rectDist(z.x, z.z, cr.x0, cr.z0, cr.x1, cr.z1) <= z.radius + REACH) {
    z.attackTarget = 'core';
    z.aimX = core.x;
    z.aimZ = core.z;
    return;
  }

  const ci = grid.indexAt(z.x, z.z);

  // 玩家躲进了大体型单位挤不进去的地方（屋里，门只有 2 米宽）：别在门口干耗，改去打发电机。
  // 要放在视线捷径前面——隔着门看得见玩家，直线冲过去就会卡在门框上
  if (z.goal === 'player' && z.def.large) {
    if (!g.nav.largeReach('player', ci)) {
      z.goal = 'core';
      if (rectDist(z.x, z.z, cr.x0, cr.z0, cr.x1, cr.z1) <= z.radius + REACH) {
        z.attackTarget = 'core';
        z.aimX = core.x;
        z.aimZ = core.z;
        return;
      }
    }
  }

  // 视线捷径：看得见目标就直接走过去，不绕格子
  if (z.noSepTimer <= 0) {
    if (z.goal === 'player') {
      if (pd < 14 && (def.crawl ? crawlClear(g, z.x, z.z, player.x, player.z) : grid.sweptClear(z.x, z.z, player.x, player.z, z.radius * 0.8))) {
        setWp(z, player.x, player.z);
        return;
      }
    } else {
      const qx = clamp(z.x, cr.x0, cr.x1);
      const qz = clamp(z.z, cr.z0, cr.z1);
      const d = Math.hypot(qx - z.x, qz - z.z);
      if (d < 10 && d > 1e-3) {
        const ex = qx + ((z.x - qx) / d) * 0.12;
        const ez = qz + ((z.z - qz) / d) * 0.12;
        if (grid.sweptClear(z.x, z.z, ex, ez, z.radius * 0.8)) {
          setWp(z, qx, qz);
          return;
        }
      }
    }
  }

  const field = def.crawl && z.goal === 'player' ? g.nav.crawlField() : g.nav.field(z.goal, z.def.large, ci);
  if (def.crawl) g.nav.prefix = -1;
  // 大体型单位贴墙站在被膨胀的格子里时，从相邻的可通行格开始走
  const borrowed = g.nav.prefix;
  const startCell = borrowed >= 0 ? borrowed : ci;
  const goalX = z.goal === 'player' ? player.x : core.x;
  const goalZ = z.goal === 'player' ? player.z : core.z;
  if ((field.dist[startCell] as number) >= INF) {
    // 站在了到不了目标的格子上（被挤进死角）：直线朝目标走，让碰撞把它带出来
    g.stats.unreachableTicks++;
    setWp(z, goalX, goalZ);
    return;
  }

  let u = borrowed >= 0 ? borrowed : (field.next[ci] as number);
  let len = 0;
  let structCell = -1;
  for (let k = 0; k < LOOK && u >= 0; k++) {
    if ((grid.structure[u] as number) >= 0 && !(def.crawl && grid.crawl[u] === 1)) {
      structCell = u;
      break;
    }
    chain[len++] = u;
    u = field.next[u] as number;
  }

  if (structCell >= 0) {
    // 路径上有建筑：够得着就直接拆（大体型单位挤不到格子中央，所以不要求走进那一格）
    const x0 = (structCell % GRID_W) - HALF_W;
    const z0 = ((structCell / GRID_W) | 0) - HALF_H;
    if (rectDist(z.x, z.z, x0, z0, x0 + 1, z0 + 1) <= z.radius + REACH) {
      z.attackTarget = 'structure';
      z.targetStructure = grid.structure[structCell] as number;
      z.aimX = x0 + 0.5;
      z.aimZ = z0 + 0.5;
      return;
    }
    if (len === 0) {
      setWp(z, x0 + 0.5, z0 + 0.5);
      return;
    }
  } else if (len === 0) {
    setWp(z, goalX, goalZ);
    return;
  }

  // 脱困模式：老老实实走格子中心
  if (z.noSepTimer > 0) {
    const c = chain[0] as number;
    setWp(z, (c % GRID_W) - HALF_W + 0.5, ((c / GRID_W) | 0) - HALF_H + 0.5);
    return;
  }

  for (let k = len - 1; k >= 0; k--) {
    const c = chain[k] as number;
    const wx = (c % GRID_W) - HALF_W + 0.5;
    const wz = ((c / GRID_W) | 0) - HALF_H + 0.5;
    // 拉直路径时留出离墙的余量：按体型半径 + 0.12 米扫，不然走的直线擦着墙角，伸出去的手臂插进墙里
    if (k === 0 || grid.sweptClear(z.x, z.z, wx, wz, z.radius + WALL_CLEAR * 0.5)) {
      setWp(z, wx, wz);
      return;
    }
  }
}

/** 爬行者的视线：沿直线逐格走，只有墙、炮塔挡它，路障可以钻 */
function crawlClear(g: Game, x0: number, z0: number, x1: number, z1: number): boolean {
  const grid = g.grid;
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(d / 0.4));
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (grid.blocksCrawler(grid.cellX(x0 + (x1 - x0) * t), grid.cellY(z0 + (z1 - z0) * t))) return false;
  }
  return true;
}

function move(g: Game, z: Zombie, i: number, dt: number): void {
  const { grid } = g;
  const prevState = z.state;
  let dvx = 0;
  let dvz = 0;

  if (z.attackTarget !== 'none') {
    z.state = 'attack';
    if (prevState !== 'attack' && z.attackTimer < 0.35) z.attackTimer = 0.35;
    z.attackTimer -= dt;
    if (z.attackTimer <= 0) {
      z.attackTimer = z.def.attackInterval;
      g.performZombieAttack(z);
    }
  } else {
    z.state = 'move';
    if (z.attackTimer > 0) z.attackTimer -= dt;
    if (z.hasWp) {
      const dx = z.wpX - z.x;
      const dz = z.wpZ - z.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 1e-4) {
        const here = grid.indexAt(z.x, z.z);
        const under = z.def.crawl && grid.crawl[here] === 1 ? z.def.crawl.slow : 1;
        const rage = z.rage && z.def.boss ? z.def.boss.rage : 1;
        const slow = (grid.slow[here] ? 0.6 : 1) * (z.slowT > 0 ? 1 - z.slowK : 1) * (z.hasteT > 0 ? 1 + z.hasteK : 1) * g.run.modSpeed * under * rage;
        const sp = z.speed * slow * Math.min(1, dl / 0.15 + 0.3);
        dvx = (dx / dl) * sp;
        dvz = (dz / dl) * sp;
        // 离墙太近：往外推一点，并去掉朝墙走的那部分速度（沿墙滑），保持肩膀和手臂不插进墙里。
        // 两边都有墙的窄口（1 格宽的门、通道）里两边的推力互相抵消，只剩"不往墙里走"；
        // 但推力的大小要按通道的宽度收：1 格宽通道里半径 0.42 的重装两边各只剩 0.08 米，满推力会把它弹来弹去
        const crawler = !!z.def.crawl;
        const cx0 = grid.cellX(z.x);
        const cy0 = grid.cellY(z.z);
        const reach = z.radius + WALL_CLEAR;
        let wx = 0;
        let wz = 0;
        for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
          for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
            if (crawler ? !grid.blocksCrawler(cx, cy) : !grid.isBlocked(cx, cy)) continue;
            // 要拆的建筑不推：僵尸得走到它跟前
            if (!grid.isStaticSolid(cx, cy)) continue;
            // 按整格算，不用车的外沿（padX / padZ）：试过，车头外沿 0.6 米盖住了车旁那一格的路点，僵尸走不到路点卡住（sim:nav 卡 106 秒）
            const x0 = cx - HALF_W;
            const x1 = x0 + 1;
            const z0 = cy - HALF_H;
            const z1 = z0 + 1;
            const ox = z.x - clamp(z.x, x0, x1);
            const oz = z.z - clamp(z.z, z0, z1);
            const d = Math.hypot(ox, oz);
            if (d >= reach || d < 1e-4) continue;
            const nx = ox / d;
            const nz = oz / d;
            const into = -(dvx * nx + dvz * nz);
            // 只去掉朝墙走的分量：路点就在这面墙的另一侧时（拐角）照样能绕过去，因为切向分量还在
            if (into > 0) {
              dvx += nx * into * 0.85;
              dvz += nz * into * 0.85;
            }
            const k = 1 - Math.max(0, d - z.radius) / WALL_CLEAR;
            wx += nx * k;
            wz += nz * k;
          }
        }
        const wl = Math.hypot(wx, wz);
        if (wl > 1) {
          wx /= wl;
          wz /= wl;
        }
        // 推力不超过自己速度的 45%：慢的重装在窄通道口被推得比走得还快就会原地打转
        const push = Math.min(WALL_GAIN, sp * 0.45);
        dvx += wx * push;
        dvz += wz * push;
      }
    }
  }

  // 与邻居的分离力
  if (z.noSepTimer <= 0) {
    let sx = 0;
    let sz = 0;
    const cx = grid.cellX(z.x);
    const cy = grid.cellY(z.z);
    const zs = g.zombies;
    for (let ny = cy - 1; ny <= cy + 1; ny++) {
      if (ny < 0 || ny >= GRID_H) continue;
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        if (nx < 0 || nx >= GRID_W) continue;
        let j = g.hashHead[ny * GRID_W + nx] as number;
        while (j >= 0) {
          if (j !== i) {
            const o = zs[j]!;
            if (o.alive) {
              const ox = z.x - o.x;
              const oz = z.z - o.z;
              const d = Math.hypot(ox, oz);
              const range = (z.radius + o.radius) * 1.5;
              if (d < range && d > 1e-4) {
                const s = 1 - d / range;
                sx += (ox / d) * s;
                sz += (oz / d) * s;
                // 已经贴上了：去掉朝它挤的那部分速度，沿着人堆边绕过去，而不是硬往里钻（不然发电机边上叠成一团）
                const touch = (z.radius + o.radius) * 1.08;
                if (d < touch) {
                  const into = -(dvx * ox + dvz * oz) / d;
                  if (into > 0) {
                    dvx += (ox / d) * into;
                    dvz += (oz / d) * into;
                  }
                }
              }
            }
          }
          j = g.hashNext[j] as number;
        }
      }
    }
    const sl = Math.hypot(sx, sz);
    if (sl > 0.05) z.crowdTime += dt;
    if (sl > 1) {
      sx /= sl;
      sz /= sl;
    }
    dvx += sx * SEP_GAIN;
    dvz += sz * SEP_GAIN;
  }

  const a = Math.min(1, 10 * dt);
  z.vx += (dvx - z.vx) * a;
  z.vz += (dvz - z.vz) * a;
  z.x += z.vx * dt;
  z.z += z.vz * dt;
  if (z.kbx !== 0 || z.kbz !== 0) {
    z.x += z.kbx * dt;
    z.z += z.kbz * dt;
    const decay = Math.exp(-9 * dt);
    z.kbx *= decay;
    z.kbz *= decay;
    if (Math.abs(z.kbx) + Math.abs(z.kbz) < 0.02) z.kbx = z.kbz = 0;
  }

  // 朝向：攻击时看目标，移动时看速度方向
  let fx = z.vx;
  let fz = z.vz;
  if (z.attackTarget !== 'none') {
    fx = z.aimX - z.x;
    fz = z.aimZ - z.z;
  }
  if (fx * fx + fz * fz > 0.01) {
    const want = Math.atan2(fx, fz);
    z.yaw += angleDiff(z.yaw, want) * Math.min(1, 9 * dt);
  }
  z.walkPhase += Math.hypot(z.vx, z.vz) * dt * 2.2;
  if (z.hitFlash > 0) z.hitFlash -= dt;
}

/** 位置修正：把重叠的僵尸推开。正在攻击的更"重"，不容易被后面的人挤走 */
function separate(g: Game, z: Zombie, i: number): void {
  const { grid } = g;
  const cx = grid.cellX(z.x);
  const cy = grid.cellY(z.z);
  const zs = g.zombies;
  const mi = z.radius * z.radius * (z.state === 'attack' ? 3 : 1);
  // 大体型（首领半径 0.6–0.95）会和 2 格外的僵尸重叠，要多看一圈
  const span = z.radius > 0.5 ? 2 : 1;
  for (let ny = cy - span; ny <= cy + span; ny++) {
    if (ny < 0 || ny >= GRID_H) continue;
    for (let nx = cx - span; nx <= cx + span; nx++) {
      if (nx < 0 || nx >= GRID_W) continue;
      let j = g.hashHead[ny * GRID_W + nx] as number;
      while (j >= 0) {
        if (j > i) {
          const o = zs[j]!;
          if (o.alive && o.leapState !== 2) {
            const ox = z.x - o.x;
            const oz = z.z - o.z;
            const d = Math.hypot(ox, oz);
            const min = z.radius + o.radius;
            if (d < min && d > 1e-4) {
              const mo = o.radius * o.radius * (o.state === 'attack' ? 3 : 1);
              const k = (min - d) * 0.95;
              const wi = mo / (mi + mo);
              const nxv = ox / d;
              const nzv = oz / d;
              z.x += nxv * k * wi;
              z.z += nzv * k * wi;
              o.x -= nxv * k * (1 - wi);
              o.z -= nzv * k * (1 - wi);
            }
          }
        }
        j = g.hashNext[j] as number;
      }
    }
  }
}

function crowded(g: Game, z: Zombie, i: number): boolean {
  const { grid } = g;
  const cx = grid.cellX(z.x);
  const cy = grid.cellY(z.z);
  const zs = g.zombies;
  for (let ny = cy - 1; ny <= cy + 1; ny++) {
    if (ny < 0 || ny >= GRID_H) continue;
    for (let nx = cx - 1; nx <= cx + 1; nx++) {
      if (nx < 0 || nx >= GRID_W) continue;
      let j = g.hashHead[ny * GRID_W + nx] as number;
      while (j >= 0) {
        if (j !== i) {
          const o = zs[j]!;
          if (o.alive && Math.hypot(z.x - o.x, z.z - o.z) < z.radius + o.radius + 0.35) return true;
        }
        j = g.hashNext[j] as number;
      }
    }
  }
  return false;
}

/** 前进方向 1 格内有别的僵尸挡着（体型越大，扫的范围越大） */
function blockedAhead(g: Game, z: Zombie, i: number): boolean {
  let dx = z.hasWp ? z.wpX - z.x : z.vx;
  let dz = z.hasWp ? z.wpZ - z.z : z.vz;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-4) return false;
  dx /= dl;
  dz /= dl;
  const { grid } = g;
  const cx = grid.cellX(z.x);
  const cy = grid.cellY(z.z);
  const zs = g.zombies;
  for (let ny = cy - 2; ny <= cy + 2; ny++) {
    if (ny < 0 || ny >= GRID_H) continue;
    for (let nx = cx - 2; nx <= cx + 2; nx++) {
      if (nx < 0 || nx >= GRID_W) continue;
      let j = g.hashHead[ny * GRID_W + nx] as number;
      while (j >= 0) {
        if (j !== i) {
          const o = zs[j]!;
          if (o.alive) {
            const ox = o.x - z.x;
            const oz = o.z - z.z;
            const d = Math.hypot(ox, oz);
            if (d > 1e-4 && d <= z.radius + o.radius + 1.0 && (ox * dx + oz * dz) / d > 0.25) return true;
          }
        }
        j = g.hashNext[j] as number;
      }
    }
  }
  return false;
}

/** 卡死检测：每 0.8 秒看一次位移，没被人群挡住却几乎没动就算卡住，吸向格子中心并关闭分离力 */
function track(g: Game, z: Zombie, i: number, dt: number): void {
  if (z.noSepTimer > 0) z.noSepTimer -= dt;
  z.sampleTimer += dt;
  if (z.sampleTimer < 0.8) return;
  const moved = Math.hypot(z.x - z.sampleX, z.z - z.sampleZ);
  const elapsed = z.sampleTimer;
  // 窗口内有相当一部分时间被邻居挤着，就当作"在人堆里"，不算被地形卡住
  const inCrowd = z.crowdTime > 0.2 || crowded(g, z, i) || blockedAhead(g, z, i);
  z.sampleX = z.x;
  z.sampleZ = z.z;
  z.sampleTimer = 0;
  z.crowdTime = 0;
  if (z.state === 'move' && moved < 0.2 && !inCrowd) {
    z.stuckTime += elapsed;
    g.stats.stuckEvents++;
    z.noSepTimer = 0.7;
    const { grid } = g;
    const idx = grid.indexAt(z.x, z.z);
    z.x += ((idx % GRID_W) - HALF_W + 0.5 - z.x) * 0.5;
    z.z += (((idx / GRID_W) | 0) - HALF_H + 0.5 - z.z) * 0.5;
  } else {
    z.stuckTime = 0;
  }
  if (z.stuckTime > z.maxStuck) z.maxStuck = z.stuckTime;
}

/**
 * 巨像冲锋：玩家在 14 米内且看得见时，停下蓄力（地上画红线），然后沿直线冲过去，
 * 撞到玩家 / 建筑造成重击；冲完硬直 3 秒，胸口的核心裸露（弱点倍率）。返回 true = 这一帧由冲锋接管
 */
function charge(g: Game, z: Zombie, i: number, dt: number): boolean {
  const c = z.def.charge!;
  const p = g.player;
  z.chargeCd -= dt;
  if (z.chargeState === 0) {
    if (z.chargeCd > 0 || !p.alive) return false;
    const d = Math.hypot(p.x - z.x, p.z - z.z);
    if (d > c.range || d < 3 || !g.grid.sweptClear(z.x, z.z, p.x, p.z, z.radius * 0.8)) return false;
    z.chargeState = 1;
    z.chargeT = c.windup;
    z.chargeDX = (p.x - z.x) / d;
    z.chargeDZ = (p.z - z.z) / d;
    g.events.emit('bossCharge', { id: z.id, stage: 'windup', x: z.x, z: z.z, dx: z.chargeDX, dz: z.chargeDZ, len: c.speed * c.time });
  }
  z.chargeT -= dt;
  z.attackTarget = 'none';
  z.hasWp = false;
  z.state = 'move';
  if (z.chargeState === 1) {
    // 蓄力：原地，面朝冲锋方向
    z.vx = z.vz = 0;
    z.yaw = Math.atan2(z.chargeDX, z.chargeDZ);
    if (z.chargeT <= 0) {
      z.chargeState = 2;
      z.chargeT = c.time;
      g.events.emit('bossCharge', { id: z.id, stage: 'go', x: z.x, z: z.z, dx: z.chargeDX, dz: z.chargeDZ, len: 0 });
    }
    return true;
  }
  if (z.chargeState === 2) {
    const nx = z.x + z.chargeDX * c.speed * dt;
    const nz = z.z + z.chargeDZ * c.speed * dt;
    // 撞到玩家
    if (p.alive && Math.hypot(p.x - nx, p.z - nz) < z.radius + p.radius + 0.2) {
      g.damagePlayer(c.damage * g.config.zombieDamage);
      p.vx += z.chargeDX * 6;
      p.vz += z.chargeDZ * 6;
      z.chargeT = 0;
    }
    // 撞到墙或建筑：停下，建筑吃重击
    const cx = g.grid.cellX(nx + z.chargeDX * z.radius);
    const cy = g.grid.cellY(nz + z.chargeDZ * z.radius);
    if (g.grid.isBlocked(cx, cy)) {
      const sid = g.grid.inBounds(cx, cy) ? (g.grid.structure[g.grid.idx(cx, cy)] as number) : -1;
      if (sid >= 0) g.damageStructure(sid, c.damage * 3);
      z.chargeT = 0;
    } else {
      z.x = nx;
      z.z = nz;
    }
    z.vx = z.chargeDX * c.speed;
    z.vz = z.chargeDZ * c.speed;
    z.walkPhase += c.speed * dt * 1.6;
    if (z.chargeT <= 0) {
      // 冲锋结束猛跺一脚：周围一圈震地，扑空了贴身也躲不掉
      const d = Math.hypot(p.x - z.x, p.z - z.z);
      if (p.alive && d < c.slam.r) {
        g.damagePlayer(c.slam.damage * g.config.zombieDamage * (1 - 0.5 * (d / c.slam.r)));
        p.vx += ((p.x - z.x) / (d || 1)) * 5;
        p.vz += ((p.z - z.z) / (d || 1)) * 5;
      }
      g.events.emit('bossSlam', { x: z.x, z: z.z, r: c.slam.r });
      z.chargeState = 3;
      z.chargeT = c.stun;
      g.events.emit('bossCharge', { id: z.id, stage: 'stun', x: z.x, z: z.z, dx: 0, dz: 0, len: 0 });
    }
    void i;
    return true;
  }
  // 硬直：胸口核心裸露
  z.vx = z.vz = 0;
  if (z.chargeT <= 0) {
    z.chargeState = 0;
    z.chargeCd = c.cd;
  }
  return true;
}

/** 吐酸者：看得见玩家（或炮塔）且在射程内时停下来吐酸，冷却期间照常走 */
function spitter(g: Game, z: Zombie, dt: number): void {
  z.spitCd -= dt;
  if (z.attackTarget !== 'none' || z.spitCd > 0) return;
  const range = z.def.spitRange as number;
  const p = g.player;
  let tx = 0;
  let tz = 0;
  let found = false;
  if (p.alive && Math.hypot(p.x - z.x, p.z - z.z) < range && g.grid.segmentClear(z.x, z.z, p.x, p.z, false)) {
    tx = p.x + p.vx * 0.6;
    tz = p.z + p.vz * 0.6;
    found = true;
  } else {
    for (const s of g.structures.values()) {
      if (s.kind === 'barricade' || s.kind === 'spikes') continue;
      const sx = s.cx - HALF_W + 0.5;
      const sz = s.cy - HALF_H + 0.5;
      if (Math.hypot(sx - z.x, sz - z.z) < range) {
        tx = sx;
        tz = sz;
        found = true;
        break;
      }
    }
  }
  if (!found) return;
  z.spitCd = z.def.spitInterval as number;
  z.yaw = Math.atan2(tx - z.x, tz - z.z);
  spitAt(g, z, tx, tz);
}

/** 尖啸者：玩家进入索敌范围后尖叫，周围的僵尸加速 */
function screamer(g: Game, z: Zombie, dt: number): void {
  const sc = z.def.scream;
  if (!sc) return;
  z.screamCd -= dt;
  if (z.screamCd > 0) return;
  const p = g.player;
  if (!p.alive || Math.hypot(p.x - z.x, p.z - z.z) > z.def.aggro) return;
  z.screamCd = sc.cd;
  g.events.emit('scream', { x: z.x, z: z.z, radius: sc.radius });
  for (const o of g.zombies) {
    if (!o.alive || o === z || Math.hypot(o.x - z.x, o.z - z.z) > sc.radius) continue;
    o.hasteT = sc.time;
    o.hasteK = sc.boost;
  }
}

export function stepZombies(g: Game, dt: number): void {
  const zs = g.zombies;
  const n = zs.length;
  const { grid } = g;

  g.hashHead.fill(-1);
  for (let i = 0; i < n; i++) {
    const z = zs[i]!;
    const c = grid.indexAt(z.x, z.z);
    g.hashNext[i] = g.hashHead[c] as number;
    g.hashHead[c] = i;
  }
  for (let i = 0; i < n; i++) {
    const z = zs[i]!;
    if (!z.alive) continue;
    if (z.dummy) {
      z.vx = z.vz = 0;
      if (z.hitFlash > 0) z.hitFlash -= dt;
      continue;
    }
    // 在空中的跳跃者：谁也拦不住，落地前不受硬直影响
    if (z.leapState === 2) {
      leapAir(g, z, dt);
      continue;
    }
    if (z.hasteT > 0) z.hasteT -= dt;
    // 硬直 / 眩晕：原地不动、不攻击，击退照样生效（蹲着蓄力的跳跃者被打断）
    if (z.stunT > 0) {
      z.stunT -= dt;
      z.vx = z.vz = 0;
      z.state = 'move';
      z.attackTarget = 'none';
      z.hasWp = false;
      if (z.leapState === 1) z.leapState = 0;
      if (z.skill) cancelSkill(g, z);
      move(g, z, i, dt);
      continue;
    }
    if (z.def.charge && g.config.extras && charge(g, z, i, dt)) continue;
    if (z.def.boss && g.config.extras && bossStep(g, z, dt)) continue;
    if (z.leapState === 1) {
      leapWindup(g, z, dt);
      continue;
    }
    think(g, z);
    if (z.def.spitRange) spitter(g, z, dt);
    if (z.def.scream) screamer(g, z, dt);
    if (z.def.leap) leaper(g, z, dt);
    if (z.def.gas) gasAura(g, z, dt);
    move(g, z, i, dt);
  }
  // 分离和推出墙交替做 2 轮：只分离一轮人堆里还会互相穿模；
  // 贴墙的人堆分离完又被墙推回去重叠，所以每轮都要再推一次墙
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const z = zs[i]!;
      if (z.alive && z.leapState !== 2) separate(g, z, i);
    }
    if (pass === 1) break;
    for (let i = 0; i < n; i++) {
      const z = zs[i]!;
      if (z.alive && z.leapState !== 2) resolveCircleVsGrid(grid, z, z.radius, false, !!z.def.crawl);
    }
  }
  const p = g.player;
  for (let i = 0; i < n; i++) {
    const z = zs[i]!;
    if (!z.alive || z.leapState === 2) continue;
    // 不许钻进玩家身体（镜头里会看到僵尸的内部）：玩家不被推，僵尸退到身体外沿
    if (p.alive) {
      const ox = z.x - p.x;
      const oz = z.z - p.z;
      const d = Math.hypot(ox, oz);
      const min = z.radius + p.radius;
      if (d < min) {
        if (d > 1e-4) {
          z.x = p.x + (ox / d) * min;
          z.z = p.z + (oz / d) * min;
        } else z.x = p.x + min;
      }
    }
    resolveCircleVsGrid(grid, z, z.radius, false, !!z.def.crawl);
    if (z.leapState === 0) track(g, z, i, dt);
  }
  // 被墙顶住、退不开的僵尸（玩家把它挤在墙角）：改成玩家被推开。僵尸是实心的，玩家也穿不过尸群
  if (p.alive) {
    for (let i = 0; i < n; i++) {
      const z = zs[i]!;
      if (!z.alive || z.leapState === 2) continue;
      const ox = p.x - z.x;
      const oz = p.z - z.z;
      const d = Math.hypot(ox, oz);
      const min = z.radius + p.radius;
      if (d >= min - 0.01 || d < 1e-4) continue;
      p.x += (ox / d) * (min - d);
      p.z += (oz / d) * (min - d);
    }
    resolveCircleVsGrid(grid, p, p.radius, true);
  }
}

// ---------------------------------------------------------------- 跳跃者

/** 跳跃者能不能沿直线跳过去：墙、房子、炮塔挡住，路障跳得过去；落脚的那一格必须是空的 */
function leapClear(g: Game, x0: number, z0: number, x1: number, z1: number): boolean {
  const grid = g.grid;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.4));
  for (let k = 1; k <= n; k++) {
    const cx = grid.cellX(x0 + ((x1 - x0) * k) / n);
    const cy = grid.cellY(z0 + ((z1 - z0) * k) / n);
    if (!grid.inBounds(cx, cy) || grid.isStaticSolid(cx, cy)) return false;
    const sid = grid.structure[grid.idx(cx, cy)] as number;
    if (sid >= 0 && (k === n || g.structures.get(sid)?.kind !== 'barricade')) return false;
  }
  return true;
}

function startLeap(g: Game, z: Zombie, tx: number, tz: number, pounce: boolean): void {
  z.leapState = 1;
  z.leapT = 0;
  z.leapX1 = tx;
  z.leapZ1 = tz;
  z.pounce = pounce;
  z.vx = z.vz = 0;
  z.attackTarget = 'none';
  z.hasWp = false;
  z.state = 'move';
  z.yaw = Math.atan2(tx - z.x, tz - z.z);
  g.events.emit('leap', { zombie: z, stage: 'windup', hit: false });
}

/** 要不要跳：玩家在扑击距离内就扑；路上挡着路障就跳过去（落脚点要离目标更近） */
function leaper(g: Game, z: Zombie, dt: number): void {
  const L = z.def.leap!;
  z.leapCd -= dt;
  if (z.leapCd > 0 || z.attackTarget === 'player' || z.attackTarget === 'core') return;
  const p = g.player;
  if (z.goal === 'player' && p.alive) {
    const d = Math.hypot(p.x - z.x, p.z - z.z);
    if (d >= L.min && d <= L.range && leapClear(g, z.x, z.z, p.x, p.z)) {
      startLeap(g, z, p.x, p.z, true);
      return;
    }
  }
  if (z.attackTarget !== 'structure' || g.structures.get(z.targetStructure)?.kind !== 'barricade') return;
  const dx = z.aimX - z.x;
  const dz = z.aimZ - z.z;
  const d = Math.hypot(dx, dz) || 1;
  const here = g.grid.indexAt(z.x, z.z);
  const field = g.nav.field(z.goal, false, here);
  for (const ahead of [1.1, 2.1]) {
    const tx = z.aimX + (dx / d) * ahead;
    const tz = z.aimZ + (dz / d) * ahead;
    const land = g.grid.indexAt(tx, tz);
    if ((field.dist[land] as number) < (field.dist[here] as number) && leapClear(g, z.x, z.z, tx, tz)) {
      startLeap(g, z, tx, tz, false);
      return;
    }
  }
}

/** 蹲下蓄力：原地不动，扑人时一直盯着玩家；蓄满起跳。落点停在玩家身前，路被挡了就不跳 */
function leapWindup(g: Game, z: Zombie, dt: number): void {
  const L = z.def.leap!;
  const p = g.player;
  z.vx = z.vz = 0;
  if (z.hitFlash > 0) z.hitFlash -= dt;
  if (z.pounce && p.alive) {
    z.leapX1 = p.x + p.vx * 0.25;
    z.leapZ1 = p.z + p.vz * 0.25;
  }
  z.yaw = Math.atan2(z.leapX1 - z.x, z.leapZ1 - z.z);
  z.leapT += dt;
  if (z.leapT < L.windup) return;
  let tx = z.leapX1;
  let tz = z.leapZ1;
  let d = Math.hypot(tx - z.x, tz - z.z);
  if (z.pounce) {
    const stop = Math.min(d, z.radius + p.radius + 0.1);
    tx -= ((tx - z.x) / (d || 1)) * stop;
    tz -= ((tz - z.z) / (d || 1)) * stop;
    d = Math.min(Math.hypot(tx - z.x, tz - z.z), L.range + 1);
  }
  if (!leapClear(g, z.x, z.z, tx, tz)) {
    z.leapState = 0;
    z.leapCd = 1;
    return;
  }
  z.leapState = 2;
  z.leapT = 0;
  z.leapX0 = z.x;
  z.leapZ0 = z.z;
  z.leapX1 = tx;
  z.leapZ1 = tz;
  z.leapDur = Math.max(0.45, d / L.speed);
  g.events.emit('leap', { zombie: z, stage: 'jump', hit: false });
}

/** 在空中：沿直线飞，离地高度走抛物线；落地时玩家在身边就扑中（伤害 + 把人撞开），然后缓一下 */
function leapAir(g: Game, z: Zombie, dt: number): void {
  const L = z.def.leap!;
  if (z.hitFlash > 0) z.hitFlash -= dt;
  z.leapT += dt;
  const k = Math.min(1, z.leapT / z.leapDur);
  z.vx = (z.leapX1 - z.leapX0) / z.leapDur;
  z.vz = (z.leapZ1 - z.leapZ0) / z.leapDur;
  z.x = z.leapX0 + (z.leapX1 - z.leapX0) * k;
  z.z = z.leapZ0 + (z.leapZ1 - z.leapZ0) * k;
  // 跳路障跳得低一些
  z.airY = 4 * (z.pounce ? L.height : L.height * 0.8) * k * (1 - k);
  z.walkPhase += dt * 2;
  if (k < 1) return;
  z.airY = 0;
  z.leapState = 0;
  z.leapCd = z.pounce ? L.cd : L.hop;
  z.vx = z.vz = 0;
  z.sampleX = z.x;
  z.sampleZ = z.z;
  z.sampleTimer = 0;
  const p = g.player;
  const d = Math.hypot(p.x - z.x, p.z - z.z);
  const hit = z.pounce && p.alive && d < z.radius + p.radius + 0.55;
  if (hit) {
    g.damagePlayer(L.damage * g.config.zombieDamage);
    p.vx += ((p.x - z.x) / (d || 1)) * 4;
    p.vz += ((p.z - z.z) / (d || 1)) * 4;
    z.everAttacked = true;
  }
  // 首领跳扑落地：周围一圈震荡（没扑中也要躲远一点）
  const q = z.def.boss?.quake;
  if (q && z.pounce) {
    if (!hit && p.alive && d < q.r) g.damagePlayer(q.damage * g.config.zombieDamage * (1 - 0.5 * (d / q.r)));
    g.events.emit('bossSlam', { x: z.x, z: z.z, r: q.r });
  }
  // 落地缓一下：反击的空档
  z.stunT = q ? 0.6 : 0.35;
  g.events.emit('leap', { zombie: z, stage: 'land', hit });
}

// ---------------------------------------------------------------- 毒雾者

/** 毒雾者身边的毒气：贴近了的玩家持续掉血 */
function gasAura(g: Game, z: Zombie, dt: number): void {
  const gas = z.def.gas!;
  const p = g.player;
  if (p.alive && Math.hypot(p.x - z.x, p.z - z.z) < gas.aura + p.radius) g.damagePlayer(gas.auraDps * dt);
}
