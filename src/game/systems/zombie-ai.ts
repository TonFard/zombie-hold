import { angleDiff, clamp } from '../core/math';
import type { Zombie } from '../entities/zombie';
import { INF } from '../nav/flowfield';
import { rectDist, resolveCircleVsGrid } from '../world/collision';
import { GRID_H, GRID_W, HALF_H, HALF_W } from '../world/grid';
import type { Game } from '../sim';

/** 沿路径向前看几格，找最远的看得见的路点（拉直路径） */
const LOOK = 6;
/** 攻击够得着的距离（在体型半径之外） */
const REACH = 0.45;
const SEP_GAIN = 1.8;
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

  const aggro = def.aggro * g.aggroScale;
  if (player.alive && aggro > 0) {
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

  // 视线捷径：看得见目标就直接走过去，不绕格子
  if (z.noSepTimer <= 0) {
    if (z.goal === 'player') {
      if (pd < 14 && grid.sweptClear(z.x, z.z, player.x, player.z, z.radius * 0.8)) {
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

  const goalX = z.goal === 'player' ? player.x : core.x;
  const goalZ = z.goal === 'player' ? player.z : core.z;
  const field = g.nav.field(z.goal, z.def.large, ci);
  // 大体型单位贴墙站在被膨胀的格子里时，从相邻的可通行格开始走
  const borrowed = g.nav.prefix;
  const startCell = borrowed >= 0 ? borrowed : ci;
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
    if ((grid.structure[u] as number) >= 0) {
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
    if (k === 0 || grid.sweptClear(z.x, z.z, wx, wz, z.radius * 0.9)) {
      setWp(z, wx, wz);
      return;
    }
  }
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
        const slow = grid.slow[grid.indexAt(z.x, z.z)] ? 0.6 : 1;
        const sp = z.speed * slow * Math.min(1, dl / 0.15 + 0.3);
        dvx = (dx / dl) * sp;
        dvz = (dz / dl) * sp;
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
  for (let ny = cy - 1; ny <= cy + 1; ny++) {
    if (ny < 0 || ny >= GRID_H) continue;
    for (let nx = cx - 1; nx <= cx + 1; nx++) {
      if (nx < 0 || nx >= GRID_W) continue;
      let j = g.hashHead[ny * GRID_W + nx] as number;
      while (j >= 0) {
        if (j > i) {
          const o = zs[j]!;
          if (o.alive) {
            const ox = z.x - o.x;
            const oz = z.z - o.z;
            const d = Math.hypot(ox, oz);
            const min = z.radius + o.radius;
            if (d < min && d > 1e-4) {
              const mo = o.radius * o.radius * (o.state === 'attack' ? 3 : 1);
              const k = (min - d) * 0.8;
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
    think(g, z);
    move(g, z, i, dt);
  }
  for (let i = 0; i < n; i++) {
    const z = zs[i]!;
    if (z.alive) separate(g, z, i);
  }
  for (let i = 0; i < n; i++) {
    const z = zs[i]!;
    if (!z.alive) continue;
    resolveCircleVsGrid(grid, z, z.radius);
    track(g, z, i, dt);
  }
}
