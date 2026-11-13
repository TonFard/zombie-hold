// 空气墙检查：npm run sim:collision
// 玩家的精细碰撞要和看得见的外形对得上：栅栏只有中间一道薄墙挡人，树干 / 断墙块按圆柱算，不占满整格。
// 僵尸和寻路仍按整格算（不受影响）。
import { resolveCircleVsGrid } from '../../src/game/world/collision';
import { HALF_H, HALF_W, SANDBAG_HALF, SLAB_HALF, type Grid } from '../../src/game/world/grid';
import { MAP_BUILDERS, MAP_ORDER, type MapId } from '../../src/game/world/maps';

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails++;
};
const R = 0.3;
/** 圆放在 (x, z) 会不会被推开 */
const pushed = (g: Grid, x: number, z: number, fine: boolean): boolean => resolveCircleVsGrid(g, { x, z }, R, fine);
/** 这一格周围 8 格都没有别的障碍（否则测到的是邻居） */
const alone = (g: Grid, cx: number, cy: number): boolean => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g.isBlocked(cx + dx, cy + dy)) return false;
  return true;
};

for (const id of [...MAP_ORDER, 'arena'] as MapId[]) {
  const m = MAP_BUILDERS[id]();
  const g = m.grid;
  console.log(`== ${id} ==`);

  // ---- 栅栏、单排沙袋：中间一道 ----
  for (const kind of ['fence', 'sandbag'] as const) {
  const HALF = kind === 'fence' ? SLAB_HALF : SANDBAG_HALF;
  let fenceCells = 0;
  let fenceBad = 0;
  for (const p of m.props) {
    if (p.kind !== kind || !p.solid || (kind === 'sandbag' && Math.min(p.x1 - p.x0, p.y1 - p.y0) !== 1)) continue;
    const alongX = p.side ? p.side === 'N' || p.side === 'S' : p.x1 - p.x0 >= p.y1 - p.y0;
    for (let cy = p.y0; cy < p.y1; cy++) {
      for (let cx = p.x0; cx < p.x1; cx++) {
        const x = cx - HALF_W + 0.5;
        const z = cy - HALF_H + 0.5;
        // 垂直于栅栏方向的两侧邻格要空着，才测得出"贴着栅栏站"
        const sideFree = alongX ? !g.isBlocked(cx, cy - 1) && !g.isBlocked(cx, cy + 1) : !g.isBlocked(cx - 1, cy) && !g.isBlocked(cx + 1, cy);
        if (!sideFree) continue;
        fenceCells++;
        const off = HALF + R + 0.02;
        const beside = alongX ? pushed(g, x, z + off, true) || pushed(g, x, z - off, true) : pushed(g, x + off, z, true) || pushed(g, x - off, z, true);
        const onIt = pushed(g, x, z, true);
        const zombie = alongX ? pushed(g, x, z + off, false) : pushed(g, x + off, z, false);
        if (beside || !onIt || !zombie) fenceBad++;
      }
    }
  }
  if (fenceCells) check(fenceBad === 0, `${kind === 'fence' ? '栅栏' : '沙袋'} ${fenceCells} 格：玩家能贴到离中线 ${(HALF + R).toFixed(2)} 米、穿不过去；僵尸仍按整格（不合格 ${fenceBad}）`);
  }

  // ---- 树干、断墙块：圆柱 ----
  for (const kind of ['tree', 'chunk'] as const) {
    let n = 0;
    let bad = 0;
    let lo = Infinity;
    let hi = 0;
    for (const p of m.props) {
      if (p.kind !== kind || !p.solid) continue;
      for (let cy = p.y0; cy < p.y1; cy++) {
        for (let cx = p.x0; cx < p.x1; cx++) {
          const post = g.post[g.idx(cx, cy)] as number;
          lo = Math.min(lo, post);
          hi = Math.max(hi, post);
          if (!alone(g, cx, cy)) continue;
          n++;
          const x = cx - HALF_W + 0.5;
          const z = cy - HALF_H + 0.5;
          // 四个斜角方向：刚好在圆柱外不挡、圆柱里挡
          for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const out = (post + R + 0.02) / Math.SQRT2;
            const inn = (post + R - 0.08) / Math.SQRT2;
            if (post <= 0 || pushed(g, x + dx * out, z + dz * out, true) || !pushed(g, x + dx * inn, z + dz * inn, true)) bad++;
          }
        }
      }
    }
    if (n) check(bad === 0 && lo > 0 && hi <= 0.5, `${kind === 'tree' ? '树干' : '断墙块'} ${n} 个：按圆柱碰撞，半径 ${lo.toFixed(2)}–${hi.toFixed(2)} 米（不合格 ${bad}）`);
  }
}

// 圆心掉进一排墙的中间（被挤 / 被击退进去）：只能往有空地的那一侧推，不能推进隔壁的墙格里来回弹
console.log('\n== 圆心落进墙里能推出来 ==');
for (const id of MAP_ORDER as MapId[]) {
  const g = MAP_BUILDERS[id]().grid;
  let n = 0;
  let bad = 0;
  for (let cy = 1; cy < g.h - 1; cy++) {
    for (let cx = 1; cx < g.w - 1; cx++) {
      if (!g.isBlocked(cx, cy)) continue;
      // 只测「一面是空地、左右是墙」的墙格（一排墙里的一格）
      const l = g.isBlocked(cx - 1, cy);
      const r = g.isBlocked(cx + 1, cy);
      const u = g.isBlocked(cx, cy - 1);
      const d = g.isBlocked(cx, cy + 1);
      if (!((l && r && u !== d) || (u && d && l !== r))) continue;
      n++;
      // 圆心在格子里靠墙排方向偏一点（最容易被推进隔壁的位置）
      const ox = l && r ? 0.3 : 0;
      const oz = u && d ? 0.3 : 0;
      const p = { x: cx - HALF_W + 0.5 + ox, z: cy - HALF_H + 0.5 + oz };
      resolveCircleVsGrid(g, p, 0.32);
      if (g.isBlocked(g.cellX(p.x), g.cellY(p.z))) bad++;
    }
  }
  check(bad === 0, `${id}：${n} 个墙排中的格子，圆心掉进去都能一次推到空地上（失败 ${bad}）`);
}

// 车：模型比 2×4 格长、车门开着伸到格子外（.logs/clip 在游戏里量的），玩家不能走进看得见的车头 / 车门里；
// 外沿挤出来的缝至少留 0.85 米，人照样过得去
console.log('\n== 车的碰撞跟着模型外沿 ==');
{
  for (const id of [...MAP_ORDER, 'arena'] as MapId[]) {
    const m = MAP_BUILDERS[id]();
    const g = m.grid;
    let n = 0;
    let bad = 0;
    for (const p of m.props) {
      if (p.kind !== 'car' || !p.solid) continue;
      // 每条边中间那一格实际伸出去多少（1 格宽的缝里会被缩小，见 Grid.padToward）
      const mx = Math.floor((p.x0 + p.x1 - 1) / 2);
      const my = Math.floor((p.y0 + p.y1 - 1) / 2);
      const cx = (p.x0 + p.x1) / 2 - HALF_W;
      const cz = (p.y0 + p.y1) / 2 - HALF_H;
      const edges: Array<[number, number, number, number, number]> = [
        [p.x0 - HALF_W, cz, -1, 0, g.padToward(p.x0, my, -1, 0)],
        [p.x1 - HALF_W, cz, 1, 0, g.padToward(p.x1 - 1, my, 1, 0)],
        [cx, p.y0 - HALF_H, 0, -1, g.padToward(mx, p.y0, 0, -1)],
        [cx, p.y1 - HALF_H, 0, 1, g.padToward(mx, p.y1 - 1, 0, 1)],
      ];
      for (const [ex, ez, dx, dz, pd] of edges) {
        if (pd < 0.1) continue;
        n++;
        // 圆的边缘在外沿以内 0.05 米：要被推出去
        const inside = { x: ex + dx * (pd - 0.05 + R), z: ez + dz * (pd - 0.05 + R) };
        const before = { ...inside };
        resolveCircleVsGrid(g, inside, R, true);
        if (Math.hypot(inside.x - before.x, inside.z - before.z) < 0.03) bad++;
      }
    }
    // 1 格宽的缝：两边的外沿加起来不能把人挤过不去
    let narrow = 0;
    for (let cy = 1; cy < g.h - 1; cy++) {
      for (let cx = 1; cx < g.w - 1; cx++) {
        if (g.isBlocked(cx, cy)) continue;
        if (g.isBlocked(cx - 1, cy) && g.isBlocked(cx + 1, cy) && 1 - g.padToward(cx - 1, cy, 1, 0) - g.padToward(cx + 1, cy, -1, 0) < 0.849) narrow++;
        if (g.isBlocked(cx, cy - 1) && g.isBlocked(cx, cy + 1) && 1 - g.padToward(cx, cy - 1, 0, 1) - g.padToward(cx, cy + 1, 0, -1) < 0.849) narrow++;
      }
    }
    if (n) check(bad === 0 && narrow === 0, `${id}：${n} 处车头 / 车门外沿挡人（没挡住 ${bad}），车边的缝都 ≥ 0.85 米（不够宽 ${narrow}）`);
  }
}

// 僵尸之间、僵尸和玩家、僵尸和墙：一大群挤在一起时不穿模
console.log('\n== 尸群挤在一起不穿模 ==');
{
  const { Game, STEP } = await import('../../src/game/sim');
  const kinds = ['walker', 'runner', 'bloater', 'breaker', 'armored', 'crawler', 'leaper', 'splitter', 'gasser'] as const;
  for (const id of ['outpost', 'farmland'] as MapId[]) {
    const g = new Game(3, id);
    g.invulnerableCore = true;
    g.invulnerablePlayer = true;
    let wall = 0;
    let inPlayer = 0;
    let deep = 0;
    let pairs = 0;
    for (let t = 0; t < 60 * 30; t++) {
      if (t % 60 === 0 && t < 60 * 15) for (let s = 0; s < g.map.spawns.length; s++) for (let k = 0; k < 3; k++) g.spawnAtGate(kinds[(t / 60 + k + s) % kinds.length]!, s);
      if (t === 60) g.spawnAtGate('colossus', 0);
      g.update(STEP);
      const zs = g.zombies.filter((z) => z.alive && z.leapState !== 2);
      for (const z of zs) {
        if (g.grid.isBlocked(g.grid.cellX(z.x), g.grid.cellY(z.z)) && !(z.def.crawl && !g.grid.blocksCrawler(g.grid.cellX(z.x), g.grid.cellY(z.z)))) wall++;
        if (Math.hypot(z.x - g.player.x, z.z - g.player.z) < z.radius + g.player.radius - 0.02) inPlayer++;
      }
      for (let i = 0; i < zs.length; i++) {
        for (let j = i + 1; j < zs.length; j++) {
          const a = zs[i]!;
          const b = zs[j]!;
          const sum = a.radius + b.radius;
          if (Math.hypot(a.x - b.x, a.z - b.z) > sum) continue;
          pairs++;
          // 重叠超过两人半径和的一半：两个身体已经叠成一个
          if (Math.hypot(a.x - b.x, a.z - b.z) < sum * 0.5) deep++;
        }
      }
    }
    check(wall === 0, `${id}：30 秒尸潮，僵尸圆心进墙 ${wall} 帧次`);
    check(inPlayer === 0, `${id}：僵尸钻进玩家身体 ${inPlayer} 帧次`);
    check(deep < pairs * 0.08, `${id}：两只僵尸叠成一个（距离 < 半径和的一半）占接触的 ${((deep / Math.max(1, pairs)) * 100).toFixed(1)}%（< 8%）`);
  }
}

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
if (fails) process.exit(1);
